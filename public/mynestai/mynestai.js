/* MYnestAI application shell. This file uses SillyTavern's public browser
 * context and deliberately does not modify SillyTavern source files. */
(function () {
    'use strict';

    const panels = ['characters', 'chat', 'browse', 'settings'];
    const settingsSections = [
        ['connection-profiles', 'Chat Generation', 'Manage saved model connections', 'fa-comment-dots'],
        ['image-generation', 'Image Generation', 'Generate and configure images', 'fa-wand-magic-sparkles'],
        ['extensions', 'Extensions', 'Configure installed extensions', 'fa-puzzle-piece'],
        ['personas', 'Persona Management', 'Create and manage your personas', 'fa-user-gear'],
        ['user-settings', 'User Settings', 'Customize your MYnestAI experience', 'fa-user-cog'],
        ['chat-presets', 'Chat Compilation Presets', 'Control how chats are assembled', 'fa-file-lines'],
        ['formatting', 'Advanced Formatting', 'Tune prompts and response formatting', 'fa-sliders'],
        ['worlds', 'Worlds / Lorebook', 'Manage world information and lorebooks', 'fa-book-open'],
    ];
    let rightPanelHome = null;
    let activePanel = 'chat';
    let mountedSettingsNode = null;
    let mountedSettingsHome = null;
    let mountedSettingsNextSibling = null;
    let mountedSettingsClassName = null;
    let groupDeleteObserver = null;
    let characterDetailObserver = null;
    let mountedBackgroundsNode = null;
    let mountedBackgroundsHome = null;
    let mountedBackgroundsNextSibling = null;
    let mountedBackgroundsClassName = null;
    let mountedBackgroundsObserver = null;
    let activeMessageMenu = null;
    let companionDirty = false;
    let companionModeOverride = null;

    const companionFields = {
        character: [
            ['backstory', 'Backstory', 'How they came to be. Origin, formative events, what they do.'],
            ['appearance', 'Appearance', 'How they look, move, dress, and carry themselves.'],
            ['goals', 'Goals', 'What they want, protect, avoid, or pursue.'],
            ['likes', 'Likes & Favorites', 'People, places, rituals, comforts, and preferences.'],
            ['innerVoice', 'Inner Voice', 'How they sound in close conversation.'],
        ],
        soul: [
            ['essence', 'Essence', 'Who they are underneath the card definition.'],
            ['traits', 'Traits', 'Core temperament, posture, and recurring qualities.'],
            ['relationalStyle', 'Relational Style', 'How they attach, trust, retreat, reconnect.'],
            ['vulnerabilities', 'Vulnerabilities', 'Soft spots, insecurities, things they rarely say.'],
            ['fears', 'Fears', 'What they can be pressured on. Literal fears and what unsettles them.'],
            ['habits', 'Habits', 'Recurring tells, rituals, conversational patterns.'],
            ['boundaries', 'Boundaries', "Lines they won't cross. Pace. Comfort limits."],
        ],
    };

    const companionSliderGroups = [
        {
            key: 'baseline',
            title: 'Baseline Affect',
            subtitle: 'Vulnerability &middot; Warmth',
            icon: 'fa-brain',
            tone: 'blue',
            description: 'How they feel by default - the emotional waterline before anything happens.',
            sliders: [
                ['warmth', 'Warmth', 'Cold', 'Affectionate', 50],
                ['trust', 'Trust', 'Guarded', 'Open', 50],
                ['calm', 'Calm', 'Anxious', 'Steady', 50],
                ['vulnerability', 'Vulnerability', 'Walled', 'Exposed', 80],
                ['longing', 'Longing', 'Content', 'Yearning', 45],
                ['hurt', 'Hurt', 'Healed', 'Tender', 5],
                ['tension', 'Tension', 'Relaxed', 'Wound up', 10],
                ['irritation', 'Irritation', 'Patient', 'Easily set off', 5],
                ['affection', 'Affection', 'Restrained', 'Effusive', 50],
                ['reassuranceNeed', 'Reassurance Need', 'Self-soothing', 'Needs words', 15],
            ],
        },
        {
            key: 'regulation',
            title: 'Regulation Style',
            subtitle: 'Recovery Speed &middot; Transparency',
            icon: 'fa-sliders',
            tone: 'gold',
            description: 'How they handle and express what they feel - venting vs. burying.',
            sliders: [
                ['suppression', 'Suppression', 'Expresses', 'Hides', 35],
                ['volatility', 'Volatility', 'Even-keeled', 'Reactive', 25],
                ['recoverySpeed', 'Recovery Speed', 'Slow', 'Fast', 55],
                ['conflictAvoidance', 'Conflict Avoidance', 'Engages', 'Withdraws', 45],
                ['reassuranceSeeking', 'Reassurance Seeking', 'Independent', 'Asks often', 40],
                ['protestBehavior', 'Protest Behavior', 'Quiet', 'Loud', 20],
                ['transparency', 'Transparency', 'Opaque', 'Reveals', 55],
                ['attachmentActivation', 'Attachment Activation', 'Detached', 'Triggers easily', 45],
                ['pride', 'Pride', 'Bends', 'Holds line', 30],
            ],
        },
        {
            key: 'relationship',
            title: 'Relationship Defaults',
            subtitle: 'closeness 20% &middot; trust 50%',
            icon: 'fa-shield-heart',
            tone: 'violet',
            description: 'Where this session starts. The engine evolves these as the conversation continues.',
            sliders: [
                ['startingCloseness', 'Starting Closeness', 'Strangers', 'Intimate', 20],
                ['startingTrust', 'Starting Trust', 'Wary', 'Trusting', 50],
                ['startingAffection', 'Starting Affection', 'Neutral', 'Affectionate', 15],
                ['startingTension', 'Starting Tension', 'Easy', 'Charged', 0],
            ],
        },
    ];

    const companionSettings = [
        ['timeAwareness', 'Time Awareness', 'Default for new chats with this companion. Sends local system time with each message and stamps companion memories with when they happened.', 'fa-clock', true],
        ['sharedMemory', 'Shared Memory Across Sessions', 'New and existing chats with this companion share one memory pool. Soul growth and the relationship with each persona carry across chats; immediate emotion stays with the current chat.', 'fa-database', true],
        ['promptInfluence', 'Use Companion Soul In Replies', 'Adds the saved soul, feelings, and relationship defaults into the next generation prompt.', 'fa-comment-dots', true],
    ];

    function context() {
        try { return window.SillyTavern?.getContext?.() ?? null; } catch { return null; }
    }

    function escapeHtml(value) {
        const element = document.createElement('div');
        element.textContent = String(value ?? '');
        return element.innerHTML;
    }

    function avatarUrl(item) {
        if (!item?.avatar || item.avatar === 'none') return '/img/ai4.png';
        return `/thumbnail?type=avatar&file=${encodeURIComponent(item.avatar)}`;
    }

    function formatMessage(value) {
        const escaped = escapeHtml(value);
        const withThoughts = escaped.replace(/\*(?!\*)([\s\S]*?)\*(?!\*)/g, (_, thought) => `<em class="mynestai-thought">${thought}</em>`);
        return withThoughts.replace(/\n/g, '<br>');
    }

    function currentCompanionTarget() {
        const ctx = context();
        if (!ctx) return null;
        if (ctx.groupId !== undefined && ctx.groupId !== null) {
            const group = ctx.groups?.find(item => String(item.id) === String(ctx.groupId));
            if (!group) return null;
            return { type: 'group', key: `group:${group.id}`, item: group };
        }
        const characterIndex = Number(ctx.characterId);
        const character = Number.isInteger(characterIndex) ? ctx.characters?.[characterIndex] : null;
        if (!character) return null;
        return { type: 'character', key: `character:${character.avatar || ctx.characterId}`, item: character };
    }

    function companionStorageKey() {
        const target = currentCompanionTarget();
        return target ? `mynestai:companion:${target.key}` : 'mynestai:companion:empty';
    }

    function defaultCompanionData() {
        const target = currentCompanionTarget();
        const item = target?.item || {};
        const tags = Array.isArray(item.data?.tags) ? item.data.tags.join(', ') : '';
        const defaults = {
            character: {
                backstory: item.scenario || item.description || '',
                appearance: '',
                goals: item.personality || '',
                likes: tags,
                innerVoice: item.mes_example || item.first_mes || '',
            },
            soul: {
                direction: '',
                essence: item.personality || item.description || '',
                traits: tags || item.personality || '',
                relationalStyle: '',
                vulnerabilities: '',
                fears: '',
                habits: '',
                boundaries: '',
            },
            sliders: {},
            settings: {},
            memories: '',
            mode: 'roleplay',
        };
        companionSliderGroups.forEach(group => group.sliders.forEach(([key, , , , value]) => { defaults.sliders[key] = value; }));
        companionSettings.forEach(([key, , , , value]) => { defaults.settings[key] = value; });
        return defaults;
    }

    function loadCompanionData() {
        const defaults = defaultCompanionData();
        try {
            const stored = JSON.parse(localStorage.getItem(companionStorageKey()) || '{}');
            const data = {
                ...defaults,
                ...stored,
                character: { ...defaults.character, ...(stored.character || {}) },
                soul: { ...defaults.soul, ...(stored.soul || {}) },
                sliders: { ...defaults.sliders, ...(stored.sliders || {}) },
                settings: { ...defaults.settings, ...(stored.settings || {}) },
            };
            if (companionModeOverride !== null) data.mode = companionModeOverride;
            return data;
        } catch {
            return defaults;
        }
    }

    function collectCompanionData() {
        const data = loadCompanionData();
        document.querySelectorAll('#mynestai-companion-page [data-companion-field]').forEach(field => {
            const scope = field.dataset.companionScope;
            if (!data[scope]) data[scope] = {};
            data[scope][field.dataset.companionField] = field.value;
        });
        document.querySelectorAll('#mynestai-companion-page [data-companion-slider]').forEach(slider => {
            data.sliders[slider.dataset.companionSlider] = Number(slider.value);
        });
        document.querySelectorAll('#mynestai-companion-page [data-companion-setting]').forEach(toggle => {
            data.settings[toggle.dataset.companionSetting] = toggle.checked;
        });
        const memories = document.querySelector('#mynestai-companion-page [data-companion-memories]');
        if (memories) data.memories = memories.value;
        return data;
    }

    function saveCompanionData() {
        const data = collectCompanionData();
        localStorage.setItem(companionStorageKey(), JSON.stringify(data));
        companionDirty = false;
        companionModeOverride = null;
        updateCompanionSaveState();
        syncCompanionPrompt(data);
        window.toastr?.success?.('Companion Soul saved.');
    }

    function syncCompanionPrompt(data = loadCompanionData()) {
        const ctx = context();
        if (!ctx?.setExtensionPrompt) return;
        if (data.mode !== 'companion' || !data.settings?.promptInfluence) {
            ctx.setExtensionPrompt('mynestai_companion_mode', '', -1, 0);
            return;
        }
        const target = currentCompanionTarget();
        const name = target?.item?.name || 'the companion';
        const sliderSummary = Object.entries(data.sliders || {}).map(([key, value]) => `${key.replace(/[A-Z]/g, match => ` ${match.toLowerCase()}`)} ${value}%`).join('; ');
        const lines = [
            `MYnestAI Companion Soul for ${name}:`,
            'This is a persistent companion, not a scene-only roleplay character. Keep the written soul consistent, let emotional and relationship state shift gradually with each message, and use shared memories when relevant.',
            data.soul?.essence && `Essence: ${data.soul.essence}`,
            data.soul?.traits && `Traits: ${data.soul.traits}`,
            data.soul?.direction && `Direction: ${data.soul.direction}`,
            data.soul?.relationalStyle && `Relational style: ${data.soul.relationalStyle}`,
            data.soul?.vulnerabilities && `Vulnerabilities: ${data.soul.vulnerabilities}`,
            data.soul?.fears && `Fears: ${data.soul.fears}`,
            data.soul?.habits && `Habits: ${data.soul.habits}`,
            data.soul?.boundaries && `Boundaries: ${data.soul.boundaries}`,
            data.character?.backstory && `Backstory: ${data.character.backstory}`,
            data.character?.appearance && `Appearance: ${data.character.appearance}`,
            data.character?.goals && `Goals: ${data.character.goals}`,
            data.character?.likes && `Likes and favorites: ${data.character.likes}`,
            data.character?.innerVoice && `Inner voice: ${data.character.innerVoice}`,
            sliderSummary && `Feeling and relationship settings: ${sliderSummary}`,
            data.settings?.timeAwareness && `Current local time: ${new Date().toLocaleString()}`,
            data.settings?.sharedMemory && data.memories && `Shared memories: ${data.memories}`,
        ].filter(Boolean).join('\n');
        ctx.setExtensionPrompt('mynestai_companion_mode', lines, 0, 0);
    }

    function markCompanionDirty() {
        companionDirty = true;
        updateCompanionSaveState();
    }

    function clampCompanionValue(value) {
        return Math.max(0, Math.min(100, value));
    }

    function recordCompanionInteraction(message) {
        const data = loadCompanionData();
        if (data.mode !== 'companion') return;
        const text = String(message || '').trim();
        if (!text) return;
        const lower = text.toLowerCase();
        const positive = /\b(thank|thanks|love|sorry|please|happy|care|trust|miss|help|sweet)\b/.test(lower);
        const tense = /\b(hate|angry|leave|never|stop|fight|hurt|sad|upset|betray)\b/.test(lower);
        const sliders = data.sliders || {};
        const shift = (key, amount) => { sliders[key] = clampCompanionValue(Number(sliders[key] ?? 50) + amount); };
        shift('startingCloseness', positive ? 2 : 1);
        shift('startingTrust', positive ? 2 : tense ? -2 : 0);
        shift('startingAffection', positive ? 2 : 0);
        shift('startingTension', tense ? 3 : -1);
        shift('calm', tense ? -2 : 1);
        shift('vulnerability', positive ? 1 : 0);
        data.sliders = sliders;
        if (data.settings?.sharedMemory) {
            const entry = `User: ${text.replace(/\s+/g, ' ').slice(0, 360)}`;
            data.memories = `${data.memories ? `${data.memories}\n` : ''}${entry}`.slice(-3000);
        }
        data.lastCompanionUpdate = new Date().toISOString();
        localStorage.setItem(companionStorageKey(), JSON.stringify(data));
        syncCompanionPrompt(data);
    }

    function recordCompanionReply() {
        const ctx = context();
        const message = Array.isArray(ctx?.chat) ? ctx.chat.at(-1) : null;
        if (!message || message.is_user || message.is_system) return;
        const data = loadCompanionData();
        if (data.mode !== 'companion') return;
        const text = String(message.mes || '').trim();
        const marker = `${ctx.chat.length}:${message.send_date || text.slice(0, 120)}`;
        if (data.lastCompanionMessageMarker === marker) return;
        const sliders = data.sliders || {};
        const shift = (key, amount) => { sliders[key] = clampCompanionValue(Number(sliders[key] ?? 50) + amount); };
        shift('startingCloseness', 1);
        shift('startingTrust', 1);
        shift('startingTension', -1);
        data.sliders = sliders;
        if (data.settings?.sharedMemory && text) {
            const entry = `Companion: ${text.replace(/\s+/g, ' ').slice(0, 360)}`;
            data.memories = `${data.memories ? `${data.memories}\n` : ''}${entry}`.slice(-3000);
        }
        data.lastCompanionMessageMarker = marker;
        data.lastCompanionUpdate = new Date().toISOString();
        localStorage.setItem(companionStorageKey(), JSON.stringify(data));
        syncCompanionPrompt(data);
    }

    function updateCompanionSaveState() {
        const save = document.getElementById('mynestai-companion-save');
        if (!save) return;
        save.disabled = !companionDirty;
        save.classList.toggle('mynestai-companion-save-ready', companionDirty);
    }

    function messageMarkup(message, character, ctx) {
        const isUser = Boolean(message.is_user);
        const name = character?.name || 'Conversation';
        const label = isUser ? (ctx.name1 || 'You') : (message.name || name);
        const avatar = isUser ? '' : `<img src="${avatarUrl(character)}" alt="">`;
        return `<article class="mynestai-message ${isUser ? 'mynestai-message-user' : 'mynestai-message-character'}" data-message-id="${ctx.chat.indexOf(message)}">${avatar}<div><span class="mynestai-message-author">${escapeHtml(label)}</span><p>${formatMessage(message.mes || '')}</p></div></article>`;
    }

    function renderChatWorkspace() {
        const workspace = document.getElementById('mynestai-chat-workspace');
        const identity = document.getElementById('mynestai-chat-identity');
        const stream = document.getElementById('mynestai-message-stream');
        const ctx = context();
        if (!workspace || !identity || !stream || !ctx) return;
        const character = ctx.groupId ? ctx.groups?.find(item => item.id === ctx.groupId) : ctx.characters?.[ctx.characterId];
        const name = character?.name || 'Conversation';
        identity.innerHTML = `<img src="${avatarUrl(character)}" alt=""><span><strong>${escapeHtml(name)}</strong><small>Ready to chat</small></span>`;
        const messages = Array.isArray(ctx.chat) ? ctx.chat.filter(message => !message.is_system) : [];
        stream.innerHTML = messages.map(message => messageMarkup(message, character, ctx)).join('') || '<div class="mynestai-empty"><div class="mynestai-empty-inner"><h2>Start the conversation</h2><p>Send the first message when you are ready.</p></div></div>';
        stream.scrollTop = stream.scrollHeight;
        bindMessageMenus(stream);
    }

    function updateStreamingMessage() {
        const workspace = document.getElementById('mynestai-chat-workspace');
        const stream = document.getElementById('mynestai-message-stream');
        const ctx = context();
        if (!workspace?.classList.contains('mynestai-visible') || !stream || !ctx) return;
        const messages = Array.isArray(ctx.chat) ? ctx.chat.filter(message => !message.is_system) : [];
        const last = messages[messages.length - 1];
        if (!last || last.is_user) return;
        const character = ctx.groupId ? ctx.groups?.find(item => item.id === ctx.groupId) : ctx.characters?.[ctx.characterId];
        const targetId = String(ctx.chat.indexOf(last));
        const existing = stream.querySelector('.mynestai-message:last-of-type');
        if (existing && existing.classList.contains('mynestai-message-character') && existing.dataset.messageId === targetId) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = messageMarkup(last, character, ctx);
            const replacement = wrapper.firstElementChild;
            existing.replaceWith(replacement);
            if (replacement) bindMessageMenu(replacement);
        } else {
            renderChatWorkspace();
            return;
        }
        stream.scrollTop = stream.scrollHeight;
    }

    function openChatWorkspace() {
        renderChatWorkspace();
        document.getElementById('mynestai-chat-workspace')?.classList.add('mynestai-visible');
        document.getElementById('mynestai-message-input')?.focus();
    }

    function closeChatWorkspace() {
        hideChatMenu();
        hideMessageMenu();
        document.getElementById('mynestai-chat-workspace')?.classList.remove('mynestai-visible');
        switchPanel('chat');
    }

    function bindMessageMenu(message) {
        message.addEventListener('contextmenu', event => {
            event.preventDefault();
            showMessageMenu(Number(message.dataset.messageId), event.clientX, event.clientY);
        });
        let holdTimer;
        message.addEventListener('pointerdown', event => {
            if (event.pointerType === 'mouse') return;
            holdTimer = window.setTimeout(() => showMessageMenu(Number(message.dataset.messageId), event.clientX, event.clientY), 500);
        });
        ['pointerup', 'pointercancel', 'pointermove'].forEach(type => message.addEventListener(type, () => window.clearTimeout(holdTimer)));
    }

    function bindMessageMenus(stream) {
        stream.querySelectorAll('.mynestai-message').forEach(bindMessageMenu);
    }

    function showMessageMenu(messageId, x, y) {
        hideMessageMenu();
        const menu = document.getElementById('mynestai-message-menu');
        const target = document.querySelector(`.mynestai-message[data-message-id="${messageId}"]`);
        if (!menu || !target) return;
        activeMessageMenu = { messageId, target };
        target.classList.add('mynestai-message-context-target');
        menu.classList.add('mynestai-visible');
        menu.style.left = `${Math.min(x, window.innerWidth - 230)}px`;
        menu.style.top = `${Math.min(y, window.innerHeight - 190)}px`;
    }

    function hideMessageMenu() {
        document.querySelector('.mynestai-message-context-target')?.classList.remove('mynestai-message-context-target');
        document.getElementById('mynestai-message-menu')?.classList.remove('mynestai-visible');
        activeMessageMenu = null;
    }

    function currentNativeChatRow() {
        const fileName = String(context()?.chatId || '').replace(/\.jsonl$/i, '');
        return [...document.querySelectorAll('#select_chat_div .select_chat_block')].find(row => {
            const value = row.getAttribute('file_name') || row.querySelector('.select_chat_block_filename')?.textContent || '';
            return value.replace(/\.jsonl$/i, '') === fileName;
        });
    }

    function openChatFilesThen(action) {
        document.getElementById('option_select_chat')?.click();
        window.setTimeout(() => {
            const row = currentNativeChatRow();
            if (row) action(row);
        }, 250);
    }

    function openChatMenu() {
        const menu = document.getElementById('mynestai-chat-menu');
        if (!menu) return;
        menu.classList.add('mynestai-visible');
    }

    function hideChatMenu() {
        document.getElementById('mynestai-chat-menu')?.classList.remove('mynestai-visible');
    }

    async function handleChatMenuAction(action) {
        hideChatMenu();
        switch (action) {
            case 'companion_mode':
                openCompanionMode();
                break;
            case 'start_new_chat':
                document.getElementById('option_start_new_chat')?.click();
                break;
            case 'manage_chat_files':
                document.getElementById('option_select_chat')?.click();
                break;
            case 'backgrounds':
                openBackgroundPicker();
                break;
            case 'import_chat':
                document.getElementById('option_select_chat')?.click();
                window.setTimeout(() => document.getElementById('chat_Import_button')?.click(), 250);
                break;
            case 'export_chat':
                openChatFilesThen(row => row.querySelector('.exportChatButton')?.click());
                break;
            case 'duplicate_chat':
                openChatFilesThen(row => row.querySelector('.chatMenuButton')?.click());
                window.setTimeout(() => document.querySelector('.chat-menu-item[data-action="duplicate_chat"]')?.click(), 80);
                break;
        }
    }

    function openBackgroundPicker() {
        hideChatMenu();
        const node = document.getElementById('Backgrounds');
        const home = document.getElementById('backgrounds-button');
        const host = document.getElementById('mynestai-bg-host');
        const picker = document.getElementById('mynestai-bg-picker');
        if (!node || !home || !host || !picker || mountedBackgroundsNode) return;
        mountedBackgroundsNode = node;
        mountedBackgroundsHome = home;
        mountedBackgroundsNextSibling = node.nextSibling;
        mountedBackgroundsClassName = node.className;
        node.classList.remove('closedDrawer');
        node.classList.add('openDrawer', 'mynestai-bg-native');
        host.appendChild(node);
        picker.classList.add('mynestai-visible');
        host.addEventListener('click', forceLockChatBackground, true);
        if (!mountedBackgroundsObserver) {
            mountedBackgroundsObserver = new MutationObserver(updateBackgroundPickerState);
        }
        mountedBackgroundsObserver.observe(host, { childList: true, subtree: true });
        updateBackgroundPickerState();
    }

    function closeBackgroundPicker() {
        const picker = document.getElementById('mynestai-bg-picker');
        const host = document.getElementById('mynestai-bg-host');
        if (!mountedBackgroundsNode || !mountedBackgroundsHome) {
            picker?.classList.remove('mynestai-visible');
            return;
        }
        host?.removeEventListener('click', forceLockChatBackground, true);
        mountedBackgroundsObserver?.disconnect();
        if (mountedBackgroundsNextSibling?.parentElement === mountedBackgroundsHome) mountedBackgroundsHome.insertBefore(mountedBackgroundsNode, mountedBackgroundsNextSibling);
        else mountedBackgroundsHome.appendChild(mountedBackgroundsNode);
        mountedBackgroundsNode.className = mountedBackgroundsClassName;
        mountedBackgroundsNode = null;
        mountedBackgroundsHome = null;
        mountedBackgroundsNextSibling = null;
        mountedBackgroundsClassName = null;
        picker?.classList.remove('mynestai-visible');
    }

    function bgExampleUrl(example) {
        return window.jQuery?.(example).data?.('url') ?? example.dataset.url;
    }

    function forceLockChatBackground(event) {
        if (event.target.closest('.jg-menu, .jg-button')) return;
        const example = event.target.closest('.bg_example');
        if (!example) return;
        const url = bgExampleUrl(example);
        const ctx = context();
        if (!url || !ctx?.chatMetadata) return;
        if (ctx.chatMetadata.custom_background !== url) {
            ctx.chatMetadata.custom_background = url;
            ctx.saveMetadataDebounced?.();
        }
        const bg1 = document.getElementById('bg1');
        if (bg1) bg1.style.backgroundImage = url;
        updateBackgroundPickerState();
        window.setTimeout(updateBackgroundPickerState, 250);
    }

    function resetChatBackground() {
        const ctx = context();
        if (!ctx?.chatMetadata) return;
        const wasLocked = Boolean(ctx.chatMetadata.custom_background);
        const unlock = document.querySelector('#mynestai-bg-picker .bg_example.locked-background .jg-unlock');
        if (unlock) unlock.click();
        if (wasLocked) {
            delete ctx.chatMetadata.custom_background;
            ctx.saveMetadataDebounced?.();
            const globalUrl = bgExampleUrl(document.querySelector('#mynestai-bg-picker #bg_menu_content .bg_example.selected'));
            const bg1 = document.getElementById('bg1');
            if (bg1) bg1.style.backgroundImage = globalUrl || '';
            updateBackgroundPickerState();
        }
    }

    function updateBackgroundPickerState() {
        const reset = document.getElementById('mynestai-bg-reset');
        const lock = context()?.chatMetadata?.custom_background;
        if (reset) reset.classList.toggle('mynestai-bg-reset-disabled', !lock);
        document.querySelectorAll('#mynestai-bg-picker .bg_example').forEach(example => {
            example.classList.toggle('locked-background', bgExampleUrl(example) === lock);
        });
    }

    async function handleMessageMenuAction(action) {
        const target = activeMessageMenu;
        hideMessageMenu();
        if (!target) return;
        const nativeMessage = document.querySelector(`#chat .mes[mesid="${target.messageId}"]`);
        if (!nativeMessage) return;
        if (action === 'generate_image') nativeMessage.querySelector('.sd_message_gen')?.click();
        if (action === 'edit_message') {
            nativeMessage.querySelector('.mes_edit')?.click();
            window.setTimeout(() => {
                const nativeTextarea = nativeMessage.querySelector('.edit_textarea');
                if (!nativeTextarea) return;
                const dialog = document.createElement('div');
                dialog.className = 'mynestai-edit-dialog';
                dialog.innerHTML = `<div class="mynestai-edit-card"><h3>Edit Message</h3><textarea>${escapeHtml(nativeTextarea.value)}</textarea><div><button type="button" data-edit-cancel>Cancel</button><button type="button" data-edit-save>Save</button></div></div>`;
                document.body.appendChild(dialog);
                const editor = dialog.querySelector('textarea');
                editor.focus();
                dialog.querySelector('[data-edit-cancel]').addEventListener('click', () => {
                    nativeMessage.querySelector('.mes_edit_cancel')?.click();
                    dialog.remove();
                });
                dialog.querySelector('[data-edit-save]').addEventListener('click', () => {
                    nativeTextarea.value = editor.value;
                    nativeMessage.querySelector('.mes_edit_done')?.click();
                    dialog.remove();
                });
            }, 50);
        }
        if (action === 'delete_message') {
            await context()?.deleteMessage?.(target.messageId, undefined, true);
            renderChatWorkspace();
        }
    }

    function sendMessage(event) {
        event.preventDefault();
        const input = document.getElementById('mynestai-message-input');
        const nativeInput = document.getElementById('send_textarea');
        const nativeSend = document.getElementById('send_but');
        const message = input?.value.trim();
        if (!message || !nativeInput || !nativeSend) return;
        recordCompanionInteraction(message);
        syncCompanionPrompt();
        nativeInput.value = message;
        nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
        nativeSend.click();
        input.value = '';
    }

    function renderTextArea(scope, [key, label, placeholder], value) {
        return `<label class="mynestai-companion-field"><span>${label}</span><textarea data-companion-scope="${scope}" data-companion-field="${key}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value || '')}</textarea></label>`;
    }

    function renderCompanionCharacterTab(data) {
        return `<section class="mynestai-companion-stack">${companionFields.character.map(field => renderTextArea('character', field, data.character?.[field[0]])).join('')}</section>`;
    }

    function renderCompanionSlider([key, label, left, right], value) {
        const safeValue = Number.isFinite(Number(value)) ? Number(value) : 50;
        return `<label class="mynestai-companion-slider"><span><strong>${label}</strong><b data-companion-slider-value="${key}">${safeValue}%</b></span><input type="range" min="0" max="100" value="${safeValue}" data-companion-slider="${key}"><small><em>${left}</em><em>${right}</em></small></label>`;
    }

    function renderCompanionSliderGroup(group, data) {
        return `<section class="mynestai-companion-card mynestai-companion-card-${group.tone}">
            <button type="button" class="mynestai-companion-card-title" data-companion-collapse="${group.key}">
                <i class="fa-solid ${group.icon}"></i><span><strong>${group.title}</strong><small>${group.subtitle}</small></span><i class="fa-solid fa-chevron-up"></i>
            </button>
            <div class="mynestai-companion-card-body"><p>${group.description}</p>${group.sliders.map(slider => renderCompanionSlider(slider, data.sliders?.[slider[0]])).join('')}</div>
        </section>`;
    }

    function renderInteractionMode(data) {
        const mode = data.mode === 'companion' ? 'companion' : 'roleplay';
        return `<section class="mynestai-companion-mode"><span>Interaction Mode</span><p>Choose whether this character behaves like an RP character or a persistent companion.</p>
            <div class="mynestai-companion-mode-options">
                <button type="button" data-companion-mode="roleplay" class="${mode === 'roleplay' ? 'active' : ''}"><i class="fa-solid fa-book-open"></i><span><strong>Roleplay</strong><small>Scene-driven chats, narrative framing, and starting scenarios.</small></span>${mode === 'roleplay' ? '<b>Active</b>' : ''}</button>
                <button type="button" data-companion-mode="companion" class="${mode === 'companion' ? 'active' : ''}"><i class="fa-regular fa-heart"></i><span><strong>Companion</strong><small>Relationship-driven chats with emotional state and companion memory.</small></span>${mode === 'companion' ? '<b>Active</b>' : ''}</button>
            </div>
        </section>`;
    }

    function renderCompanionSoulTab(data) {
        return `<section class="mynestai-companion-section-title"><strong>Identity</strong></section>
        <section class="mynestai-companion-stack">${renderTextArea('soul', ['essence', 'Essence', 'Who they are underneath the card definition.'], data.soul?.essence)}${renderTextArea('soul', ['traits', 'Traits', 'Submissive, loyal, playful, guarded, curious...'], data.soul?.traits)}${renderTextArea('soul', ['direction', 'Direction', 'Optional steering for the LLM.'], data.soul?.direction)}${companionFields.soul.slice(2).map(field => renderTextArea('soul', field, data.soul?.[field[0]])).join('')}</section>
        <section class="mynestai-companion-section-title"><strong>Fine-tune Feelings</strong></section>
        ${companionSliderGroups.map(group => renderCompanionSliderGroup(group, data)).join('')}
        `;
    }

    function renderCompanionToggle([key, title, description, icon], data) {
        const checked = data.settings?.[key] ? 'checked' : '';
        return `<label class="mynestai-companion-toggle"><i class="fa-solid ${icon}"></i><span><strong>${title}</strong><small>${description}</small></span><input type="checkbox" data-companion-setting="${key}" ${checked}></label>`;
    }

    function renderCompanionSettingsTab(data) {
        return `<section class="mynestai-companion-stack">${companionSettings.map(setting => renderCompanionToggle(setting, data)).join('')}</section>`;
    }

    function setCompanionMode(mode) {
        companionModeOverride = mode === 'companion' ? 'companion' : 'roleplay';
        renderCompanionMode();
        markCompanionDirty();
    }

    function renderCompanionMode() {
        const page = document.getElementById('mynestai-companion-page');
        if (!page) return;
        const data = loadCompanionData();
        const target = currentCompanionTarget();
        const name = target?.item?.name || 'Companion';
        const companionContent = data.mode === 'companion' ? `${renderCompanionSoulTab(data)}
            <section class="mynestai-companion-section-title"><strong>Character Profile</strong></section>
            ${renderCompanionCharacterTab(data)}
            <section class="mynestai-companion-section-title"><strong>Companion Context</strong></section>
            ${renderCompanionSettingsTab(data)}
            <label class="mynestai-companion-memory"><span>Shared Memory Pool</span><textarea data-companion-memories placeholder="Important memories that should carry across chats.">${escapeHtml(data.memories || '')}</textarea></label>` : '';
        const body = `${renderInteractionMode(data)}${companionContent}`;
        page.innerHTML = `<header class="mynestai-companion-header">
            <button type="button" data-companion-close aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button>
            <div class="mynestai-companion-title"><div><h1>Companion Soul</h1></div><span>${escapeHtml(name)}</span></div>
            <button id="mynestai-companion-save" type="button" disabled><i class="fa-solid fa-check"></i>Save</button>
        </header>
        <main class="mynestai-companion-body">${body}</main>`;
        bindCompanionMode();
        updateCompanionSaveState();
    }

    function bindCompanionMode() {
        const page = document.getElementById('mynestai-companion-page');
        if (!page) return;
        page.querySelector('[data-companion-close]')?.addEventListener('click', closeCompanionMode);
        page.querySelector('#mynestai-companion-save')?.addEventListener('click', saveCompanionData);
        page.querySelectorAll('[data-companion-mode]').forEach(button => button.addEventListener('click', () => setCompanionMode(button.dataset.companionMode)));
        const handleCompanionInput = event => {
            if (event.target.matches('[data-companion-slider]')) {
                const value = page.querySelector(`[data-companion-slider-value="${event.target.dataset.companionSlider}"]`);
                if (value) value.textContent = `${event.target.value}%`;
            }
            markCompanionDirty();
        };
        page.querySelectorAll('textarea, input').forEach(input => {
            input.addEventListener('input', handleCompanionInput);
            input.addEventListener('change', handleCompanionInput);
        });
        page.querySelectorAll('[data-companion-collapse]').forEach(button => button.addEventListener('click', () => {
            button.closest('.mynestai-companion-card')?.classList.toggle('mynestai-companion-card-collapsed');
        }));
        page.querySelector('[data-companion-generate]')?.addEventListener('click', generateCompanionSoul);
    }

    function generateCompanionSoul() {
        const target = currentCompanionTarget();
        const character = target?.item || {};
        const setValue = (field, value) => {
            const area = document.querySelector(`[data-companion-scope="soul"][data-companion-field="${field}"]`);
            if (area && !area.value.trim()) area.value = value || '';
        };
        setValue('essence', character.personality || character.description || '');
        setValue('traits', Array.isArray(character.data?.tags) ? character.data.tags.join(', ') : character.personality || '');
        setValue('direction', 'Keep the companion emotionally consistent. Let feelings change slowly through trust, tension, reassurance, and shared memories.');
        setValue('relationalStyle', character.scenario || '');
        markCompanionDirty();
    }

    function openCompanionMode() {
        hideChatMenu();
        companionDirty = false;
        companionModeOverride = null;
        document.getElementById('mynestai-companion-page')?.classList.add('mynestai-visible');
        renderCompanionMode();
    }

    function closeCompanionMode() {
        companionDirty = false;
        companionModeOverride = null;
        document.getElementById('mynestai-companion-page')?.classList.remove('mynestai-visible');
    }

    function createShell() {
        if (document.getElementById('mynestai-app-nav')) return;
        const container = document.createElement('main');
        container.id = 'mynestai-panels';
        container.innerHTML = `
            <section id="mynestai-characters-panel" class="mynestai-panel"><div class="mynestai-header"><h1>Characters</h1><p>Create, import, edit, and organise your characters.</p></div><div id="mynestai-characters-host" aria-live="polite"></div></section>
            <section id="mynestai-chat-panel" class="mynestai-panel active"><div class="mynestai-header"><h1>Chats</h1><p>Choose a character or group to continue a conversation.</p></div><div id="mynestai-chat-list"></div></section>
            <section id="mynestai-browse-panel" class="mynestai-panel"><div class="mynestai-header"><h1>Browse</h1><p>Find new characters and add them to your collection.</p></div><div id="mynestai-browse-toolbar" class="mynestai-browse-toolbar"><label class="mynestai-browse-search"><i class="fa-solid fa-magnifying-glass"></i><input id="mynestai-browse-query" type="search" placeholder="Search..."></label><select id="mynestai-browse-page" class="mynestai-browse-page" title="Page"><option value="1">Page 1</option></select><select id="mynestai-browse-tag" class="mynestai-browse-tag" title="Filter by tag"><option value="">Add a tag...</option></select><button id="mynestai-browse-refresh" class="mynestai-browse-refresh" type="button" title="Refresh"><i class="fa-solid fa-rotate"></i></button></div><div id="mynestai-browse-chips" class="mynestai-browse-chips"></div><div id="mynestai-browse-status" class="mynestai-browse-status"></div><div id="mynestai-browse-grid" class="mynestai-browse-grid" aria-live="polite"></div></section>
            <section id="mynestai-settings-panel" class="mynestai-panel"><div id="mynestai-settings-content"></div></section>`;
        document.body.appendChild(container);

        const nav = document.createElement('nav');
        nav.id = 'mynestai-app-nav';
        nav.className = 'mynestai-start-hidden';
        nav.setAttribute('aria-label', 'MYnestAI navigation');
        nav.innerHTML = [['characters', 'Characters', 'fa-user-group'], ['chat', 'Chats', 'fa-comments'], ['browse', 'Browse', 'fa-compass'], ['settings', 'Settings', 'fa-gear']].map(([panel, label, icon]) => `<button class="mynestai-nav-button" data-panel="${panel}" aria-label="${label}" title="${label}"><i class="fa-solid ${icon}"></i></button>`).join('');
        document.body.appendChild(nav);
        const workspace = document.createElement('section');
        workspace.id = 'mynestai-chat-workspace';
        workspace.setAttribute('aria-label', 'Chat');
        workspace.innerHTML = `
            <header class="mynestai-chat-header"><button id="mynestai-workspace-back" type="button" aria-label="Back to chats"><i class="fa-solid fa-arrow-left"></i></button><div id="mynestai-chat-identity"></div><button class="mynestai-chat-more" type="button" aria-label="Chat options"><i class="fa-solid fa-ellipsis"></i></button></header>
            <main id="mynestai-message-stream" class="mynestai-message-stream"></main>
            <form id="mynestai-composer" class="mynestai-composer"><textarea id="mynestai-message-input" rows="1" placeholder="Message..."></textarea><button type="submit" aria-label="Send message"><i class="fa-solid fa-arrow-up"></i></button></form>`;
        document.body.appendChild(workspace);
        const chatMenu = document.createElement('div');
        chatMenu.id = 'mynestai-chat-menu';
        chatMenu.className = 'mynestai-overlay-menu';
        chatMenu.innerHTML = '<div class="mynestai-menu-backdrop"></div><div class="mynestai-menu-panel"><header><strong>Chat options</strong><button type="button" data-menu-close aria-label="Close">×</button></header><button data-chat-action="companion_mode"><i class="fa-regular fa-heart"></i>Companion Soul</button><button data-chat-action="start_new_chat"><i class="fa-solid fa-plus"></i>Start New Chat</button><button data-chat-action="manage_chat_files"><i class="fa-solid fa-folder-open"></i>Manage Chat Files</button><button data-chat-action="backgrounds"><i class="fa-solid fa-image"></i>Background</button><button data-chat-action="import_chat"><i class="fa-solid fa-file-import"></i>Import Chat</button><button data-chat-action="export_chat"><i class="fa-solid fa-file-export"></i>Export Chat</button><button data-chat-action="duplicate_chat"><i class="fa-solid fa-copy"></i>Duplicate Chat</button></div>';
        document.body.appendChild(chatMenu);
        const companionPage = document.createElement('section');
        companionPage.id = 'mynestai-companion-page';
        companionPage.setAttribute('aria-label', 'Companion Soul');
        document.body.appendChild(companionPage);
        const messageMenu = document.createElement('div');
        messageMenu.id = 'mynestai-message-menu';
        messageMenu.className = 'mynestai-overlay-menu';
        messageMenu.innerHTML = '<div class="mynestai-menu-backdrop"></div><div class="mynestai-menu-panel"><button data-message-action="generate_image"><i class="fa-solid fa-image"></i>Generate Image</button><button data-message-action="edit_message"><i class="fa-solid fa-pencil"></i>Edit Message</button><button class="mynestai-menu-danger" data-message-action="delete_message"><i class="fa-solid fa-trash-can"></i>Delete Message</button></div>';
        document.body.appendChild(messageMenu);
        const bgPicker = document.createElement('div');
        bgPicker.id = 'mynestai-bg-picker';
        bgPicker.className = 'mynestai-overlay-menu';
        bgPicker.setAttribute('aria-label', 'Background picker');
        bgPicker.innerHTML = '<div class="mynestai-menu-backdrop"></div><div class="mynestai-bg-panel"><header><strong>Background</strong><span class="mynestai-bg-subtitle">applies to this chat</span><button type="button" data-menu-close aria-label="Close">×</button></header><div id="mynestai-bg-host" class="mynestai-bg-host"></div><footer><button type="button" id="mynestai-bg-reset" class="mynestai-bg-reset"><i class="fa-solid fa-rotate-left"></i>Reset to default</button></footer></div>';
        document.body.appendChild(bgPicker);
        document.getElementById('mynestai-workspace-back').addEventListener('click', closeChatWorkspace);
        workspace.querySelector('.mynestai-chat-more').addEventListener('click', openChatMenu);
        document.getElementById('mynestai-composer').addEventListener('submit', sendMessage);
        chatMenu.addEventListener('click', event => { if (event.target.closest('.mynestai-menu-backdrop,[data-menu-close]')) hideChatMenu(); const button = event.target.closest('[data-chat-action]'); if (button) handleChatMenuAction(button.dataset.chatAction); });
        messageMenu.addEventListener('click', event => { if (event.target.closest('.mynestai-menu-backdrop')) hideMessageMenu(); const button = event.target.closest('[data-message-action]'); if (button) handleMessageMenuAction(button.dataset.messageAction); });
        bgPicker.addEventListener('click', event => {
            if (event.target.closest('.mynestai-menu-backdrop,[data-menu-close]')) closeBackgroundPicker();
            if (event.target.closest('.mynestai-bg-panel')) window.setTimeout(updateBackgroundPickerState, 0);
        });
        document.getElementById('mynestai-bg-reset').addEventListener('click', resetChatBackground);
        document.addEventListener('pointerdown', event => {
            if (event.target.closest('.mynestai-menu-panel, .mynestai-bg-panel, .mynestai-chat-more')) return;
            if (document.getElementById('mynestai-chat-menu')?.classList.contains('mynestai-visible')) hideChatMenu();
            if (document.getElementById('mynestai-message-menu')?.classList.contains('mynestai-visible')) hideMessageMenu();
            if (document.getElementById('mynestai-bg-picker')?.classList.contains('mynestai-visible')) closeBackgroundPicker();
        });
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            hideChatMenu();
            hideMessageMenu();
            closeBackgroundPicker();
            if (document.getElementById('mynestai-companion-page')?.classList.contains('mynestai-visible')) closeCompanionMode();
        });
        prepareChatImport();
        nav.addEventListener('click', event => { const button = event.target.closest('.mynestai-nav-button'); if (button) switchPanel(button.dataset.panel); });
        renderSettingsHome();
    }

    function prepareChatImport() {
        const button = document.getElementById('chat_Import_button');
        const input = document.getElementById('chat_Import_file');
        if (!button || !input || button.dataset.mynestaiImportReady) return;
        button.dataset.mynestaiImportReady = 'true';
        button.querySelector('i')?.classList.replace('fa-file-Import', 'fa-file-import');
        button.addEventListener('click', () => input.click());
        input.addEventListener('change', async () => {
            const ctx = context();
            try {
                for (const file of [...input.files]) {
                    const extension = file.name.split('.').pop()?.toLowerCase();
                    if (!['json', 'jsonl'].includes(extension)) continue;
                    const formData = new FormData();
                    formData.append('avatar', file);
                    formData.append('file_type', extension);
                    formData.append('user_name', ctx?.name1 || 'User');
                    const character = Number.isInteger(ctx?.characterId) ? ctx.characters?.[ctx.characterId] : null;
                    if (character?.avatar) formData.append('avatar_url', character.avatar);
                    if (character?.name) formData.append('character_name', character.name);
                    const endpoint = ctx?.groupId ? '/api/chats/group/import' : '/api/chats/import';
                    const response = await fetch(endpoint, { method: 'POST', body: formData, headers: ctx?.getRequestHeaders?.({ omitContentType: true }) || {}, cache: 'no-cache' });
                    if (!response.ok) throw new Error(`Chat import failed: ${response.status}`);
                }
                window.toastr?.success?.('Chat imported.');
                document.getElementById('option_select_chat')?.click();
            } catch (error) {
                console.error('MYnestAI chat import failed', error);
                window.toastr?.error?.('The selected chat could not be imported.');
            } finally {
                input.value = '';
            }
        });
    }

    function mountCharacterManager() {
        const host = document.getElementById('mynestai-characters-host');
        const panel = document.getElementById('right-nav-panel');
        const home = document.getElementById('rightNavHolder');
        if (!host || !panel || !home) { if (host) host.innerHTML = '<div class="mynestai-placeholder"><p>Character management is loading…</p></div>'; return; }
        rightPanelHome ??= home;
        host.appendChild(panel);
        panel.classList.remove('closedDrawer');
        document.getElementById('rm_button_characters')?.click();
        prepareCharacterImport();
        placeGroupDeleteButton();
        observeGroupDeleteButton();
        prepareCharacterDetails();
        observeCharacterDetails();
    }

    function prepareCharacterDetails() {
        const panelTabs = document.getElementById('right-nav-panel-tabs');
        const moreMenu = document.getElementById('char-management-dropdown');
        if (panelTabs && !document.getElementById('mynestai-character-detail-back')) {
            const backButton = document.createElement('button');
            backButton.id = 'mynestai-character-detail-back';
            backButton.type = 'button';
            backButton.setAttribute('aria-label', 'Back to characters');
            backButton.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
            backButton.addEventListener('click', () => document.getElementById('rm_button_back')?.click());
            panelTabs.prepend(backButton);
        }
        if (moreMenu) {
            const allowedOptions = new Set(['default', 'set_chat_character_settings', 'renameCharButton', 'set_as_assistant', 'show_char_gallery']);
            [...moreMenu.options].forEach(option => {
                if (!allowedOptions.has(option.id) && option.value !== 'default') option.remove();
            });
            const overrideOption = moreMenu.querySelector('#set_chat_character_settings');
            if (overrideOption) overrideOption.textContent = 'Character Settings Override';
        }
        updateCharacterDetailChrome();
    }

    function updateCharacterDetailChrome() {
        const host = document.getElementById('mynestai-characters-host');
        const editPanel = document.getElementById('rm_ch_create_block');
        if (!host || !editPanel) return;
        const isOpen = getComputedStyle(editPanel).display !== 'none';
        host.classList.toggle('mynestai-character-detail-open', isOpen);
        document.getElementById('mynestai-app-nav')?.classList.toggle('mynestai-nav-hidden', isOpen);
    }

    function observeCharacterDetails() {
        if (characterDetailObserver) return;
        const editPanel = document.getElementById('rm_ch_create_block');
        if (!editPanel) return;
        characterDetailObserver = new MutationObserver(updateCharacterDetailChrome);
        characterDetailObserver.observe(editPanel, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    function prepareCharacterImport() {
        const button = document.getElementById('character_Import_button');
        const input = document.getElementById('character_Import_file');
        if (!button || !input) return;
        button.classList.remove('fa-file-Import');
        button.classList.add('fa-file-import');
        if (button.dataset.mynestaiImportReady) return;
        button.dataset.mynestaiImportReady = 'true';
        button.addEventListener('click', () => input.click());
        input.addEventListener('change', () => importCharacterFiles([...input.files]));
    }

    async function importCharacterFiles(files) {
        const ctx = context();
        const input = document.getElementById('character_Import_file');
        const supportedExtensions = new Set(['json', 'png', 'yaml', 'yml', 'charx', 'byaf']);
        const imported = [];
        try {
            for (const file of files) {
                const extension = file.name.split('.').pop()?.toLowerCase();
                if (!extension || !supportedExtensions.has(extension)) continue;
                const formData = new FormData();
                formData.append('avatar', file);
                formData.append('file_type', extension);
                formData.append('user_name', ctx?.name1 || 'User');
                const response = await fetch('/api/characters/import', {
                    method: 'POST',
                    body: formData,
                    headers: ctx?.getRequestHeaders?.({ omitContentType: true }) || {},
                    cache: 'no-cache',
                });
                const data = await response.json();
                if (!response.ok || data.error) throw new Error(data.error || response.statusText);
                if (data.file_name) imported.push(`${data.file_name}.png`);
            }
            if (imported.length) {
                await ctx?.getCharacters?.();
                const importedIndex = ctx?.characters?.findIndex(character => character.avatar === imported.at(-1));
                if (importedIndex >= 0) await ctx.selectCharacterById?.(importedIndex);
                window.toastr?.success?.(imported.length === 1 ? 'Character imported.' : `${imported.length} characters imported.`);
            }
        } catch (error) {
            console.error('MYnestAI character import failed', error);
            window.toastr?.error?.('The selected file could not be imported.', 'Import failed');
        } finally {
            if (input) input.value = '';
        }
    }

    let browseCache = [];
    let browseLoading = false;
    let selectedBrowseTags = [];
    let browsePage = 1;
    let browseTotalPages = 1;

    function browseRequestHeaders() {
        const ctx = context();
        const headers = ctx?.getRequestHeaders?.() || {};
        headers['Content-Type'] = 'application/json';
        return headers;
    }

    function formatBrowseRating(rating) {
        if (rating === null || rating === undefined || isNaN(Number(rating))) return 'N/A';
        return Number(rating).toFixed(1);
    }

    async function loadBrowseCards() {
        if (browseLoading) return;
        const grid = document.getElementById('mynestai-browse-grid');
        const status = document.getElementById('mynestai-browse-status');
        if (!grid || !status) return;
        const query = document.getElementById('mynestai-browse-query')?.value.trim() || '';
        const params = new URLSearchParams({ page: String(browsePage), per_page: '20', nsfw: 'true' });
        if (query) params.set('search', query);
        browseLoading = true;
        status.textContent = 'Loading cards...';
        grid.innerHTML = '';
        try {
            const response = await fetch(`/api/characters/browse?${params.toString()}`, { method: 'GET', headers: browseRequestHeaders(), cache: 'no-cache' });
            const data = await response.json();
            if (!response.ok || data.error) throw new Error(data.message || response.statusText);
            browseCache = Array.isArray(data.nodes) ? data.nodes : [];
            browseTotalPages = Math.max(1, Number(data.total_pages) || 1);
            if (browsePage > browseTotalPages) browsePage = browseTotalPages;
            populateBrowsePageOptions();
            if (browseCache.length === 0) {
                status.textContent = 'No characters found. Try a different search.';
                return;
            }
            status.textContent = `${data.count ?? browseCache.length} cards found. Page ${browsePage} of ${browseTotalPages}.`;
            selectedBrowseTags = selectedBrowseTags.filter((tag) => browseCache.some((card) => (card.tags || []).includes(tag)));
            renderBrowseChips();
            populateBrowseTagOptions();
            renderBrowseGrid();
        } catch (error) {
            console.error('MYnestAI browse failed', error);
            status.textContent = 'Could not load characters from Chub.';
        } finally {
            browseLoading = false;
        }
    }

    function populateBrowsePageOptions() {
        const select = document.getElementById('mynestai-browse-page');
        if (!select) return;
        const options = [];
        for (let page = 1; page <= browseTotalPages; page++) {
            options.push(`<option value="${page}">Page ${page}</option>`);
        }
        select.innerHTML = options.join('');
        select.value = String(browsePage);
    }

    function populateBrowseTagOptions() {
        const select = document.getElementById('mynestai-browse-tag');
        if (!select) return;
        const tags = [...new Set(browseCache.flatMap((card) => card.tags || []))].sort((a, b) => a.localeCompare(b));
        select.innerHTML = '<option value="">Add a tag...</option>' + tags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join('');
        select.value = '';
    }

    function renderBrowseChips() {
        const host = document.getElementById('mynestai-browse-chips');
        if (!host) return;
        host.innerHTML = selectedBrowseTags.map((tag) => `<button type="button" class="mynestai-browse-chip" data-tag="${escapeHtml(tag)}" title="Remove tag">${escapeHtml(tag)} ×</button>`).join('');
        host.classList.toggle('mynestai-browse-chips-hidden', selectedBrowseTags.length === 0);
    }

    function renderBrowseGrid() {
        const grid = document.getElementById('mynestai-browse-grid');
        if (!grid) return;
        const visible = selectedBrowseTags.length ? browseCache.filter((card) => selectedBrowseTags.every((tag) => (card.tags || []).includes(tag))) : browseCache;
        grid.innerHTML = visible.map((card) => `
            <article class="mynestai-browse-card" data-card-id="${escapeHtml(card.id)}" tabindex="0">
                <div class="mynestai-browse-cover"><img src="${escapeHtml(card.avatarUrl || '')}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('mynestai-browse-cover-empty')"><span class="mynestai-browse-rating"><i class="fa-solid fa-star"></i>${escapeHtml(formatBrowseRating(card.rating))}</span></div>
                <div class="mynestai-browse-body"><strong class="mynestai-browse-name">${escapeHtml(card.name)}</strong>${card.nsfw ? '<span class="mynestai-browse-nsfw-badge">NSFW</span>' : ''}<div class="mynestai-browse-tags">${(card.tags || []).slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div></div>
                <footer class="mynestai-browse-actions"><button class="mynestai-browse-download" type="button" data-card-id="${escapeHtml(card.id)}"><i class="fa-solid fa-download"></i>Download</button></footer>
            </article>`).join('');
    }

    function renderBrowseDetail(card) {
        const ctx = context();
        const host = document.createElement('div');
        host.className = 'mynestai-detail-overlay';
        host.setAttribute('role', 'dialog');
        host.setAttribute('aria-modal', 'true');
        host.setAttribute('aria-label', card.name);
        host.innerHTML = `
            <div class="mynestai-detail-backdrop" data-browse-close></div>
            <div class="mynestai-detail">
                <header><strong>${escapeHtml(card.name)}</strong><button type="button" data-browse-close aria-label="Close">x</button></header>
                <div class="mynestai-detail-body">
                    <div class="mynestai-detail-cover"><img src="${escapeHtml(card.avatarUrl || '')}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'"></div>
                    <div class="mynestai-detail-info">
                        <div class="mynestai-detail-stats"><span><i class="fa-solid fa-star"></i>${escapeHtml(formatBrowseRating(card.rating))}</span><span><i class="fa-solid fa-heart"></i>${escapeHtml(card.favorites ?? '-')}</span>${card.nsfw ? '<span class="mynestai-browse-nsfw-badge">NSFW</span>' : ''}</div>
                        ${(card.tags || []).length ? `<div class="mynestai-detail-tags">${card.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
                        <div class="mynestai-detail-meta">${card.fullPath ? `<p>by <strong>${escapeHtml(card.fullPath.split('/')[0] || 'unknown')}</strong></p>` : ''}${card.lastActivityAt ? `<p>Updated ${escapeHtml(String(card.lastActivityAt).slice(0, 10))}</p>` : ''}<p>${card.cardUrl ? 'Character card (PNG) ready to import.' : 'Card file unavailable.'}</p></div>
                    </div>
                </div>
                <footer><button type="button" data-browse-close>Cancel</button><button class="mynestai-browse-download" type="button" data-card-id="${escapeHtml(card.id)}" ${card.cardUrl ? '' : 'disabled'}><i class="fa-solid fa-download"></i>Download</button></footer>
            </div>`;
        const closeDetail = () => {
            host.remove();
            if (ctx?.eventSource && ctx.eventTypes?.MESSAGE_SENT) ctx.eventSource.emit(ctx.eventTypes.MESSAGE_SENT, { message: null });
        };
        host.querySelectorAll('[data-browse-close]').forEach((node) => node.addEventListener('click', closeDetail));
        host.querySelectorAll('.mynestai-browse-download').forEach((button) => button.addEventListener('click', () => { downloadBrowseCard(button.dataset.cardId); closeDetail(); }));
        document.body.appendChild(host);
    }

    async function downloadBrowseCard(id) {
        const card = browseCache.find((c) => String(c.id) === String(id));
        if (!card?.cardUrl) {
            window.toastr?.error?.('This card has no downloadable file.', 'Download failed');
            return;
        }
        const ctx = context();
        const button = document.querySelector(`.mynestai-browse-download[data-card-id="${id}"]`);
        if (button) { button.disabled = true; button.textContent = 'Importing...'; }
        try {
            const response = await fetch('/api/characters/browse/download', { method: 'POST', headers: browseRequestHeaders(), body: JSON.stringify({ cardUrl: card.cardUrl }), cache: 'no-cache' });
            const data = await response.json();
            if (!response.ok || data.error) throw new Error(data.message || response.statusText);
            await ctx?.getCharacters?.();
            const importedIndex = ctx?.characters?.findIndex((character) => character.avatar === `${data.file_name}.png`);
            if (importedIndex >= 0) await ctx?.selectCharacterById?.(importedIndex);
            window.toastr?.success?.(`${card.name} downloaded to your collection.`);
            browseCache = browseCache.filter((c) => String(c.id) !== String(id));
            renderBrowseGrid();
            const status = document.getElementById('mynestai-browse-status');
            if (status) status.textContent = `${browseCache.length} cards remain.`;
        } catch (error) {
            console.error('MYnestAI browse download failed', error);
            window.toastr?.error?.(error.message || 'Could not download that card.', 'Download failed');
            if (button) { button.disabled = false; button.textContent = 'Download'; }
        }
    }

    function mountBrowse() {
        const grid = document.getElementById('mynestai-browse-grid');
        const query = document.getElementById('mynestai-browse-query');
        const page = document.getElementById('mynestai-browse-page');
        const tag = document.getElementById('mynestai-browse-tag');
        const refresh = document.getElementById('mynestai-browse-refresh');
        const status = document.getElementById('mynestai-browse-status');
        if (!grid) return;
        loadBrowseCards();
        const debounce = (fn, wait) => { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; };
        const scheduleReload = debounce(() => loadBrowseCards(), 400);
        grid.addEventListener('click', (event) => {
            const download = event.target.closest('.mynestai-browse-download');
            if (download) {
                downloadBrowseCard(download.dataset.cardId);
                return;
            }
            const cardElement = event.target.closest('.mynestai-browse-card');
            if (!cardElement) return;
            const card = browseCache.find((c) => String(c.id) === String(cardElement.dataset.cardId));
            if (card) renderBrowseDetail(card);
        });
        grid.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const article = event.target.closest('.mynestai-browse-card');
            if (!article) return;
            const card = browseCache.find((c) => String(c.id) === String(article.dataset.cardId));
            if (card) renderBrowseDetail(card);
        });
        query?.addEventListener('input', () => { browsePage = 1; scheduleReload(); });
        page?.addEventListener('change', () => {
            const next = Number(page.value) || 1;
            if (next === browsePage) return;
            browsePage = next;
            loadBrowseCards();
        });
        tag?.addEventListener('change', () => {
            if (!tag.value || selectedBrowseTags.includes(tag.value)) return;
            selectedBrowseTags.push(tag.value);
            tag.value = '';
            renderBrowseChips();
            renderBrowseGrid();
        });
        document.getElementById('mynestai-browse-chips')?.addEventListener('click', (event) => {
            const chip = event.target.closest('.mynestai-browse-chip');
            if (!chip) return;
            selectedBrowseTags = selectedBrowseTags.filter((selected) => selected !== chip.dataset.tag);
            renderBrowseChips();
            renderBrowseGrid();
        });
        refresh?.addEventListener('click', loadBrowseCards);
        if (status && browseCache.length === 0) status.textContent = 'Ready.';
    }

    function unmountBrowse() {
        browseCache = [];
        selectedBrowseTags = [];
        browsePage = 1;
        browseTotalPages = 1;
        const status = document.getElementById('mynestai-browse-status');
        if (status) status.textContent = '';
        const grid = document.getElementById('mynestai-browse-grid');
        if (grid) grid.innerHTML = '';
        document.querySelector('.mynestai-detail-overlay')?.remove();
    }

    // The native control already owns SillyTavern's delete confirmation and
    // request handler. Reposition it in the group details header so MYnestAI
    // keeps that behavior without duplicating it.
    function placeGroupDeleteButton() {
        const chatLoreButton = document.querySelector('#group-metadata-controls .chat_lorebook_button');
        const deleteButton = document.getElementById('rm_group_delete');
        if (!chatLoreButton?.parentElement || !deleteButton || chatLoreButton.nextElementSibling === deleteButton) return;
        chatLoreButton.insertAdjacentElement('afterend', deleteButton);
    }

    function observeGroupDeleteButton() {
        if (groupDeleteObserver) return;
        const panel = document.getElementById('right-nav-panel');
        if (!panel) return;
        groupDeleteObserver = new MutationObserver(placeGroupDeleteButton);
        groupDeleteObserver.observe(panel, { childList: true, subtree: true });
    }

    function unmountCharacterManager() {
        const panel = document.getElementById('right-nav-panel');
        if (panel && rightPanelHome && panel.parentElement !== rightPanelHome) rightPanelHome.appendChild(panel);
    }

    function renderChats() {
        const list = document.getElementById('mynestai-chat-list');
        const ctx = context();
        if (!list || !ctx) return;
        const characters = Array.isArray(ctx.characters) ? ctx.characters : [];
        const groups = Array.isArray(ctx.groups) ? ctx.groups : [];
        const items = [...characters.map((item, id) => ({ type: 'character', id, item })), ...groups.map(item => ({ type: 'group', id: item.id, item }))];
        if (!items.length) { list.innerHTML = '<div class="mynestai-empty"><div class="mynestai-empty-inner"><div class="mynestai-empty-icon"><i class="fa-solid fa-comments"></i></div><h2>No chats yet</h2><p>Create or import a character to start talking.</p></div></div>'; return; }
        list.innerHTML = items.map(({ type, id, item }) => { const name = item.name || 'Unnamed character'; return `<button class="mynestai-chat-card" data-type="${type}" data-id="${escapeHtml(id)}"><img class="mynestai-chat-avatar" src="${avatarUrl(item)}" alt=""><span class="mynestai-chat-info"><strong class="mynestai-chat-name">${escapeHtml(name)}</strong></span><i class="mynestai-chat-arrow fa-solid fa-chevron-right"></i></button>`; }).join('');
        list.querySelectorAll('.mynestai-chat-card').forEach(card => card.addEventListener('click', () => openChat(card.dataset.type, card.dataset.id)));
    }

    function renderSettingsHome() {
        const content = document.getElementById('mynestai-settings-content');
        if (!content) return;
        unmountNativeSettings();
        document.getElementById('mynestai-app-nav')?.classList.remove('mynestai-nav-hidden');
        content.innerHTML = `<div class="mynestai-settings-heading"><h1>Settings</h1><p>Configure your MYnestAI experience.</p></div><div class="mynestai-settings-list">${settingsSections.map(([id, title, description, icon]) => `<button class="mynestai-settings-row" data-settings-section="${id}"><i class="fa-solid ${icon}"></i><span><strong>${title}</strong><small>${description}</small></span><i class="fa-solid fa-chevron-right"></i></button>`).join('')}</div>`;
        content.querySelectorAll('[data-settings-section]').forEach(button => button.addEventListener('click', () => renderSettingsSection(button.dataset.settingsSection)));
    }

    function renderSettingsSection(id) {
        const content = document.getElementById('mynestai-settings-content');
        const section = settingsSections.find(([sectionId]) => sectionId === id);
        if (!content || !section) return;
        unmountNativeSettings();
        document.getElementById('mynestai-app-nav')?.classList.add('mynestai-nav-hidden');
        const [, title, description, icon] = section;
        content.innerHTML = `<div class="mynestai-settings-page-header"><button id="mynestai-settings-back" type="button" aria-label="Back to settings"><i class="fa-solid fa-arrow-left"></i></button><div><h1>${title}</h1><p>${description}</p></div></div><div id="mynestai-settings-native-host" class="mynestai-settings-page"></div>`;
        document.getElementById('mynestai-settings-back').addEventListener('click', renderSettingsHome);
        mountNativeSettings(id, icon, title);
    }

    function getNativeSettingsNode(id) {
        const nodes = {
            // Connection profiles render their editable details inside the API
            // panel, so the complete native panel must move as one unit.
            'connection-profiles': document.getElementById('rm_api_block'),
            'image-generation': document.getElementById('sd_container'),
            extensions: document.getElementById('rm_extensions_block'),
            personas: document.getElementById('PersonaManagement'),
            'user-settings': document.getElementById('user-settings-block'),
            'chat-presets': document.getElementById('ai_response_configuration'),
            formatting: document.getElementById('AdvancedFormatting'),
            worlds: document.getElementById('WorldInfo'),
        };
        return nodes[id] ?? null;
    }

    function mountNativeSettings(id, icon, title) {
        const host = document.getElementById('mynestai-settings-native-host');
        const node = getNativeSettingsNode(id);
        if (!host || !node || !node.parentElement) {
            if (host) host.innerHTML = `<i class="fa-solid ${icon}"></i><h2>${title}</h2><p>This section is still loading. Please try again in a moment.</p>`;
            return;
        }
        mountedSettingsNode = node;
        mountedSettingsHome = node.parentElement;
        mountedSettingsNextSibling = node.nextSibling;
        mountedSettingsClassName = node.className;
        node.classList.remove('closedDrawer');
        node.classList.add('mynestai-native-settings');
        host.appendChild(node);
        if (id === 'image-generation') configureImageGenerationPage(node);
    }

    function configureImageGenerationPage(node) {
        const drawers = node.querySelectorAll('.inline-drawer');
        const labels = ['Connection', 'Prompt'];
        drawers.forEach((drawer, index) => {
            const toggle = drawer.querySelector('.inline-drawer-toggle');
            const content = drawer.querySelector('.inline-drawer-content');
            const label = drawer.querySelector('b');
            if (content) content.style.display = 'block';
            if (toggle) toggle.classList.add('mynestai-static-drawer');
            if (label && labels[index]) {
                const translatedLabel = label.querySelector('[data-i18n]');
                if (translatedLabel) translatedLabel.textContent = labels[index];
                else label.textContent = labels[index];
            }
        });
    }

    function unmountNativeSettings() {
        if (!mountedSettingsNode || !mountedSettingsHome) return;
        if (mountedSettingsNextSibling?.parentElement === mountedSettingsHome) mountedSettingsHome.insertBefore(mountedSettingsNode, mountedSettingsNextSibling);
        else mountedSettingsHome.appendChild(mountedSettingsNode);
        mountedSettingsNode.className = mountedSettingsClassName;
        mountedSettingsNode = null;
        mountedSettingsHome = null;
        mountedSettingsNextSibling = null;
        mountedSettingsClassName = null;
    }

    async function openChat(type, id) {
        const ctx = context();
        if (!ctx) return;
        if (type === 'group') {
            const group = ctx.groups?.find(item => String(item.id) === String(id));
            if (group?.chat_id) await ctx.openGroupChat?.(id, group.chat_id);
        } else {
            await ctx.selectCharacterById?.(Number(id), { switchMenu: false });
        }
        syncCompanionPrompt();
        setChatChrome(true);
        hideShell();
        openChatWorkspace();
    }

    function openSettings() { setChatChrome(false); hideShell(); document.getElementById('leftNavDrawerIcon')?.click(); }

    function setChatChrome(isChatOpen) {
        document.body.classList.toggle('mynestai-in-chat', isChatOpen);
    }
    function hideShell() {
        unmountCharacterManager();
        document.getElementById('mynestai-panels')?.classList.add('mynestai-shell-hidden');
        document.getElementById('mynestai-app-nav')?.classList.add('mynestai-nav-hidden');
        document.querySelectorAll('.mynestai-nav-button').forEach(button => button.classList.remove('active'));
    }

    function switchPanel(name) {
        if (!panels.includes(name)) return;
        activePanel = name;
        setChatChrome(false);
        document.getElementById('mynestai-panels')?.classList.remove('mynestai-shell-hidden');
        document.getElementById('mynestai-app-nav')?.classList.remove('mynestai-nav-hidden');
        document.querySelectorAll('.mynestai-panel').forEach(panel => panel.classList.toggle('active', panel.id === `mynestai-${name}-panel`));
        document.querySelectorAll('.mynestai-nav-button').forEach(button => button.classList.toggle('active', button.dataset.panel === name));
        if (name === 'characters') mountCharacterManager(); else unmountCharacterManager();
        if (name === 'chat') renderChats();
        if (name === 'browse') mountBrowse(); else unmountBrowse();
    }

    function attachEvents() {
        const ctx = context();
        if (!ctx?.eventSource) return;
        const refresh = () => { if (activePanel === 'chat') renderChats(); };
        const refreshWorkspace = () => { if (document.getElementById('mynestai-chat-workspace')?.classList.contains('mynestai-visible')) renderChatWorkspace(); };
        ['CHARACTER_PAGE_LOADED', 'CHARACTER_EDITED', 'CHARACTER_DELETED', 'CHARACTER_DUPLICATED', 'GROUP_UPDATED', 'CHAT_CHANGED'].forEach(type => { const event = ctx.eventTypes?.[type]; if (event) ctx.eventSource.on(event, refresh); });
        ['MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'CHAT_CHANGED'].forEach(type => { const event = ctx.eventTypes?.[type]; if (event) ctx.eventSource.on(event, refreshWorkspace); });
        const streamingToken = ctx.eventTypes?.STREAM_TOKEN_RECEIVED;
        if (streamingToken) ctx.eventSource.on(streamingToken, () => updateStreamingMessage());
        const messageReceived = ctx.eventTypes?.MESSAGE_RECEIVED;
        if (messageReceived) ctx.eventSource.on(messageReceived, recordCompanionReply);
        ['CHAT_LOADED', 'CHAT_CHANGED'].forEach(type => {
            const event = ctx.eventTypes?.[type];
            if (event) ctx.eventSource.on(event, () => setChatChrome(Boolean(context()?.characterId !== undefined || context()?.groupId)));
        });
    }

    function revealNavigationWhenReady() {
        const ctx = context();
        const nav = document.getElementById('mynestai-app-nav');
        const event = ctx?.eventTypes?.APP_READY;
        if (!ctx?.eventSource || !event || !nav) return;
        ctx.eventSource.once(event, () => nav.classList.remove('mynestai-start-hidden'));
    }

    function initialize() { createShell(); switchPanel('chat'); attachEvents(); revealNavigationWhenReady(); }
    function waitForReady() { const timer = window.setInterval(() => { if (context()) { window.clearInterval(timer); initialize(); } }, 50); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitForReady); else waitForReady();
})();
