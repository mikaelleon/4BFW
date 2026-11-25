import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import * as db from '../db.js';
import { resolveGuild } from '../lib/context.js';
import { MAX_PATTERN_LEN, checkFilters, regexProblem } from '../lib/filter.js';
import { COLOR } from '../lib/format.js';

const serverOpt = (s) =>
  s.addStringOption((o) => o.setName('server').setDescription('Which server (only needed in DMs)').setAutocomplete(true));
const MAX_RULES = 100;

const settingsText = (cfg) =>
  [
    `On a hit: **${cfg.filter_action === 'hold' ? 'hold for a moderator' : 'reject the post'}**`,
    `Discord invite links: **${cfg.block_invites ? 'blocked' : 'allowed'}**`,
    `Any links: **${cfg.block_links ? 'blocked' : 'allowed'}**`,
  ].join('\n');

export default {
  admin: true,
  manageOnly: true,
  data: new SlashCommandBuilder()
    .setName('filter')
    .setDescription('Auto-filter for submissions: blocked words, regex, invite and link blocker (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addSubcommand((s) =>
      serverOpt(
        s
          .setName('add')
          .setDescription('Block a word, a phrase or a regex')
          .addStringOption((o) => o.setName('pattern').setDescription('The word, phrase or regex').setRequired(true).setMaxLength(MAX_PATTERN_LEN))
          .addStringOption((o) =>
            o
              .setName('kind')
              .setDescription('word = whole word or phrase, ignoring case (default). regex = a regular expression')
              .addChoices({ name: 'Word or phrase', value: 'word' }, { name: 'Regex', value: 'regex' }),
          ),
      ),
    )
    .addSubcommand((s) =>
      serverOpt(s.setName('remove').setDescription('Remove a rule').addIntegerOption((o) => o.setName('id').setDescription('Rule number from /filter list').setRequired(true).setMinValue(1))),
    )
    .addSubcommand((s) => serverOpt(s.setName('list').setDescription('Show the rules and settings')))
    .addSubcommand((s) =>
      serverOpt(
        s
          .setName('settings')
          .setDescription('What happens on a hit, and the invite / link blockers')
          .addStringOption((o) =>
            o
              .setName('action')
              .setDescription('On a hit: reject the post, or hold it in the mod log for approval')
              .addChoices({ name: 'Reject the post', value: 'reject' }, { name: 'Hold for a moderator', value: 'hold' }),
          )
          .addBooleanOption((o) => o.setName('invites').setDescription('Block Discord invite links'))
          .addBooleanOption((o) => o.setName('links').setDescription('Block every link')),
      ),
    )
    .addSubcommand((s) =>
      serverOpt(s.setName('test').setDescription('Check a text against the filter without posting').addStringOption((o) => o.setName('text').setDescription('Text to check').setRequired(true).setMaxLength(2000))),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { guild, error } = await resolveGuild(interaction, { admin: true, manageOnly: true });
    if (error) return interaction.editReply(error);
    db.updateGuild(guild.id, {}); // make sure the server has a settings row
    const cfg = db.getGuild(guild.id);
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const pattern = interaction.options.getString('pattern', true).trim();
      const kind = interaction.options.getString('kind') ?? 'word';
      if (!pattern) return interaction.editReply('Give a word, phrase or regex.');
      if (kind === 'regex') {
        const problem = regexProblem(pattern);
        if (problem) return interaction.editReply(problem);
      }
      const rules = db.listFilterRules(guild.id);
      if (rules.length >= MAX_RULES) return interaction.editReply(`You can have at most ${MAX_RULES} rules. Remove some first.`);
      if (rules.some((r) => r.kind === kind && r.pattern.toLowerCase() === pattern.toLowerCase())) return interaction.editReply('That rule already exists.');
      const id = db.addFilterRule(guild.id, kind, pattern);
      return interaction.editReply(`Rule **#${id}** added (${kind}: \`${pattern}\`). ${cfg.filter_action === 'hold' ? 'Matching posts are held for a moderator.' : 'Matching posts are rejected.'}`);
    }

    if (sub === 'remove') {
      const id = interaction.options.getInteger('id', true);
      return interaction.editReply(db.removeFilterRule(guild.id, id) ? `Rule #${id} removed.` : `There is no rule #${id}.`);
    }

    if (sub === 'settings') {
      const patch = {};
      const action = interaction.options.getString('action');
      const invites = interaction.options.getBoolean('invites');
      const links = interaction.options.getBoolean('links');
      if (action) patch.filter_action = action;
      if (invites !== null) patch.block_invites = invites ? 1 : 0;
      if (links !== null) patch.block_links = links ? 1 : 0;
      if (!Object.keys(patch).length) return interaction.editReply('Nothing to change. Pass at least one option.');
      return interaction.editReply(`Saved.\n${settingsText(db.updateGuild(guild.id, patch))}`);
    }

    if (sub === 'test') {
      const hit = checkFilters(guild.id, [interaction.options.getString('text', true)], { cfg });
      return interaction.editReply(
        hit ? `**Would be ${cfg.filter_action === 'hold' ? 'held' : 'rejected'}.** Matched: ${hit.detail}` : 'No match. This text would be posted normally.',
      );
    }

    // list
    const rules = db.listFilterRules(guild.id);
    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle('Auto-filter')
      .setDescription(settingsText(cfg))
      .addFields({
        name: `Rules (${rules.length})`,
        value: rules.length ? rules.slice(0, 40).map((r) => `**#${r.id}** ${r.kind}: \`${r.pattern}\``).join('\n').slice(0, 1024) : 'None. Add one with `/filter add`.',
      });
    return interaction.editReply({ embeds: [embed] });
  },
};
