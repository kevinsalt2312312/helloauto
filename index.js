const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const fs = require('fs');
const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));

// ─────────────────────────────────────
//  FILL THESE IN
// ─────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = "1517632985342541864";
const OWNER_ID = "1517636202801529033";
// ─────────────────────────────────────

const DB_FILE   = "./data.json";
const KEYS_FILE = "./keys.json";

function loadDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
  return JSON.parse(fs.readFileSync(DB_FILE));
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function loadKeys() {
  if (!fs.existsSync(KEYS_FILE)) fs.writeFileSync(KEYS_FILE, JSON.stringify({}, null, 2));
  return JSON.parse(fs.readFileSync(KEYS_FILE));
}
function saveKeys(k) { fs.writeFileSync(KEYS_FILE, JSON.stringify(k, null, 2)); }

const activeJobs = {};

function stopJob(uid) {
  if (activeJobs[uid]) { clearTimeout(activeJobs[uid].timer); delete activeJobs[uid]; }
}

async function sendSelfMsg(userToken, channelId, message) {
  try {
    const res = await fetch(`https://discord.com/api/v9/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': userToken,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({ content: message })
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.message || JSON.stringify(data) };
    return { ok: true, id: data.id };
  } catch (e) { return { ok: false, error: e.message }; }
}

function scheduleJob(uid, cfg) {
  stopJob(uid);
  const fire = async () => {
    await sendSelfMsg(cfg.userToken, cfg.channelId, cfg.message);
    const base = cfg.intervalMin * 60000;
    const jitter = (Math.random() * 4 - 2) * 60000;
    activeJobs[uid].timer = setTimeout(fire, Math.max(base + jitter, 60000));
  };
  activeJobs[uid] = { ...cfg, timer: null };
  fire();
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('claim').setDescription('Claim your Auto-Adv license key')
    .addStringOption(o => o.setName('key').setDescription('Your license key').setRequired(true)),
  new SlashCommandBuilder()
    .setName('panel').setDescription('Open your Auto-Adv control panel'),
  new SlashCommandBuilder()
    .setName('status').setDescription('Check if your auto-adv is running'),
  new SlashCommandBuilder()
    .setName('stop').setDescription('Stop your auto-adv'),
  new SlashCommandBuilder()
    .setName('genkeys').setDescription('[Owner only] Generate license keys')
    .addIntegerOption(o => o.setName('amount').setDescription('How many keys (max 100)').setRequired(true)),
  new SlashCommandBuilder()
    .setName('listkeys').setDescription('[Owner only] List all keys'),
  new SlashCommandBuilder()
    .setName('revokekey').setDescription('[Owner only] Revoke a users key')
    .addUserOption(o => o.setName('user').setDescription('User to revoke').setRequired(true)),
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`Bot ready: ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('Slash commands registered');
});

client.on('interactionCreate', async interaction => {

  if (interaction.isChatInputCommand() && interaction.commandName === 'genkeys') {
    if (interaction.user.id !== OWNER_ID)
      return interaction.reply({ content: 'Owner only.', ephemeral: true });
    const amount = Math.min(interaction.options.getInteger('amount'), 100);
    const keys = loadKeys();
    const generated = [];
    for (let i = 0; i < amount; i++) {
      const rand = () => Math.random().toString(36).substring(2, 6).toUpperCase();
      const key = `PIKE-${rand()}-${rand()}-${rand()}`;
      keys[key] = { claimed: false, claimedBy: null, claimedAt: null, expiry: null };
      generated.push(key);
    }
    saveKeys(keys);
    fs.writeFileSync('./generated_keys.txt', generated.join('\n'));
    return interaction.reply({
      content: `Generated **${amount}** keys. Each expires 10 days after being claimed.`,
      files: ['./generated_keys.txt'],
      ephemeral: true
    });
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'listkeys') {
    if (interaction.user.id !== OWNER_ID)
      return interaction.reply({ content: 'Owner only.', ephemeral: true });
    const keys = loadKeys();
    const total = Object.keys(keys).length;
    const claimed = Object.values(keys).filter(v => v.claimed).length;
    const lines = Object.entries(keys).map(([k, v]) => {
      const status = v.claimed ? 'CLAIMED  ' : 'AVAILABLE';
      const exp = v.expiry ? v.expiry.split('T')[0] : 'on claim';
      const by = v.claimedBy ? ` | user: ${v.claimedBy}` : '';
      return `[${status}] ${k} | expires: ${exp}${by}`;
    });
    const text = `Total: ${total} | Claimed: ${claimed} | Available: ${total - claimed}\n${'─'.repeat(60)}\n` + lines.join('\n');
    fs.writeFileSync('./keys_list.txt', text);
    return interaction.reply({ content: `**${total}** keys total, **${claimed}** claimed:`, files: ['./keys_list.txt'], ephemeral: true });
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'revokekey') {
    if (interaction.user.id !== OWNER_ID)
      return interaction.reply({ content: 'Owner only.', ephemeral: true });
    const target = interaction.options.getUser('user');
    const db = loadDB();
    const keys = loadKeys();
    if (!db.users[target.id])
      return interaction.reply({ content: `<@${target.id}> has no key.`, ephemeral: true });
    const userKey = db.users[target.id].key;
    stopJob(target.id);
    if (keys[userKey]) { keys[userKey].claimed = false; keys[userKey].claimedBy = null; saveKeys(keys); }
    delete db.users[target.id];
    saveDB(db);
    return interaction.reply({ content: `Revoked key from <@${target.id}>. Key \`${userKey}\` is now available again.`, ephemeral: true });
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'claim') {
    const keyInput = interaction.options.getString('key').trim().toUpperCase();
    const keys = loadKeys();
    const db   = loadDB();
    const uid  = interaction.user.id;
    if (db.users[uid]?.key)
      return interaction.reply({ content: 'You already have a key! Use `/panel` to manage it.', ephemeral: true });
    const keyData = keys[keyInput];
    if (!keyData)
      return interaction.reply({ content: 'Invalid key. Double check it and try again.', ephemeral: true });
    if (keyData.claimed)
      return interaction.reply({ content: 'This key has already been claimed by someone.', ephemeral: true });

    const expiry = new Date(Date.now() + 10 * 86400000).toISOString();
    keys[keyInput] = { claimed: true, claimedBy: uid, claimedAt: new Date().toISOString(), expiry };
    saveKeys(keys);
    db.users[uid] = { key: keyInput, expiry, config: null };
    saveDB(db);

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('🔑 Key Claimed')
      .setDescription(`<@${uid}> has claimed an **ADVANCED** key!`)
      .addFields(
        { name: 'Key',     value: `\`${keyInput}\``, inline: false },
        { name: 'Expires', value: `<t:${Math.floor(new Date(expiry).getTime() / 1000)}:F>`, inline: true },
        { name: 'User ID', value: `\`${uid}\``, inline: true }
      )
      .setFooter({ text: 'Use /panel to set up your auto-adv' })
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'panel') {
    const db  = loadDB();
    const uid = interaction.user.id;
    if (!db.users[uid]?.key)
      return interaction.reply({ content: 'You need to `/claim` a key first.', ephemeral: true });
    if (new Date(db.users[uid].expiry) < new Date())
      return interaction.reply({ content: 'Your key has expired. Contact the owner for a new one.', ephemeral: true });

    const isRunning = !!activeJobs[uid];
    const cfg = db.users[uid].config || {};
    const expiryTs = Math.floor(new Date(db.users[uid].expiry).getTime() / 1000);

    const embed = new EmbedBuilder()
      .setColor(isRunning ? 0x57F287 : 0xED4245)
      .setTitle('⚙️ Auto-Adv Panel')
      .setDescription('Control your auto-advertisement.')
      .addFields(
        { name: '📡 Status',   value: isRunning ? '🟢 **Running**' : '🔴 **Stopped**', inline: true },
        { name: '📢 Channel',  value: cfg.channelId ? `<#${cfg.channelId}>` : '`Not set`', inline: true },
        { name: '⏱️ Interval', value: cfg.intervalMin ? `\`${cfg.intervalMin} min\`` : '`Not set`', inline: true },
        { name: '📅 Expires',  value: `<t:${expiryTs}:R>`, inline: true },
      )
      .setFooter({ text: 'Your token is only used to send messages as you.' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_setup').setLabel('⚙️ Setup / Edit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('panel_start').setLabel('▶ Start').setStyle(ButtonStyle.Success).setDisabled(isRunning || !cfg.userToken),
      new ButtonBuilder().setCustomId('panel_stop').setLabel('■ Stop').setStyle(ButtonStyle.Danger).setDisabled(!isRunning),
    );
    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'status') {
    const uid = interaction.user.id;
    const db  = loadDB();
    if (!db.users[uid]?.key)
      return interaction.reply({ content: 'No key claimed. Use `/claim` first.', ephemeral: true });
    const cfg = db.users[uid].config || {};
    return interaction.reply({
      content: activeJobs[uid]
        ? `🟢 Running — posting to <#${cfg.channelId}> every ~**${cfg.intervalMin} minutes**.`
        : '🔴 Stopped — use `/panel` to start.',
      ephemeral: true
    });
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'stop') {
    const uid = interaction.user.id;
    if (!activeJobs[uid])
      return interaction.reply({ content: 'Nothing is currently running.', ephemeral: true });
    stopJob(uid);
    return interaction.reply({ content: '🔴 Auto-adv stopped.', ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId === 'panel_setup') {
    const uid = interaction.user.id;
    const cfg = loadDB().users[uid]?.config || {};
    const modal = new ModalBuilder().setCustomId('modal_setup').setTitle('Auto-Adv Setup');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('userToken').setLabel('Your Discord Token')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Browser Discord → F12 → Network → send a msg → Authorization header')
          .setValue(cfg.userToken || '').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('channelId').setLabel('Channel ID to post in')
          .setStyle(TextInputStyle.Short).setPlaceholder('Right-click channel → Copy Channel ID')
          .setValue(cfg.channelId || '').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('intervalMin').setLabel('Interval in minutes (e.g. 30)')
          .setStyle(TextInputStyle.Short).setPlaceholder('30')
          .setValue(cfg.intervalMin ? String(cfg.intervalMin) : '30').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('message').setLabel('Your advertisement message')
          .setStyle(TextInputStyle.Paragraph).setPlaceholder('Type your full ad here…')
          .setValue(cfg.message || '').setRequired(true)
      ),
    );
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_setup') {
    const uid         = interaction.user.id;
    const userToken   = interaction.fields.getTextInputValue('userToken').trim();
    const channelId   = interaction.fields.getTextInputValue('channelId').trim();
    const intervalMin = Math.max(parseInt(interaction.fields.getTextInputValue('intervalMin')) || 30, 1);
    const message     = interaction.fields.getTextInputValue('message');
    await interaction.deferReply({ ephemeral: true });
    const test = await sendSelfMsg(userToken, channelId, message);
    if (!test.ok)
      return interaction.editReply(`❌ Test failed: \`${test.error}\`\nCheck your token and channel ID.`);
    const db = loadDB();
    if (!db.users[uid]) return interaction.editReply('No key found. Use /claim first.');
    db.users[uid].config = { userToken, channelId, intervalMin, message };
    saveDB(db);
    scheduleJob(uid, { userToken, channelId, intervalMin, message });
    return interaction.editReply(
      `✅ **Saved and started!**\nPosting to <#${channelId}> every **~${intervalMin} minutes**.\nUse \`/stop\` to stop anytime.`
    );
  }

  if (interaction.isButton() && interaction.customId === 'panel_start') {
    const uid = interaction.user.id;
    const cfg = loadDB().users[uid]?.config;
    if (!cfg) return interaction.reply({ content: 'No config yet. Use Setup first.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const test = await sendSelfMsg(cfg.userToken, cfg.channelId, cfg.message);
    if (!test.ok) return interaction.editReply(`❌ Failed: \`${test.error}\``);
    scheduleJob(uid, cfg);
    return interaction.editReply(`✅ Started! Posting every ~${cfg.intervalMin} min.`);
  }

  if (interaction.isButton() && interaction.customId === 'panel_stop') {
    stopJob(interaction.user.id);
    return interaction.reply({ content: '🔴 Auto-adv stopped.', ephemeral: true });
  }
});

client.login(BOT_TOKEN);
