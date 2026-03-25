(function () {
  'use strict';

  // ── Determine server base URL and businessId from this script's src ──
  const currentScript = document.currentScript;
  if (!currentScript) return;

  const scriptSrc = currentScript.src;
  const srcUrl = new URL(scriptSrc);
  const BASE_URL = srcUrl.origin;
  const businessId = srcUrl.searchParams.get('id');

  if (!businessId) {
    console.warn('[Binai Widget] No business id found in script src. Add ?id=YOUR_ID');
    return;
  }

  // ── Fetch business config then mount ──
  fetch(BASE_URL + '/api/config/' + businessId)
    .then(function (r) { return r.json(); })
    .then(function (config) { mountWidget(config); })
    .catch(function (e) { console.error('[Binai Widget] Failed to load config:', e); });

  function mountWidget(config) {
    const name = config.name || 'צ\'אט';
    const color = config.color || '#3B82F6';
    const greeting = config.greeting || 'שלום! איך אפשר לעזור לך היום?';

    // ── Shadow DOM host ──
    const host = document.createElement('div');
    host.id = 'binai-widget-host';
    host.style.cssText = 'position:fixed;bottom:24px;left:24px;z-index:2147483647;font-family:sans-serif;';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    // ── Styles ──
    const style = document.createElement('style');
    style.textContent = `
      *{box-sizing:border-box;margin:0;padding:0;}

      /* Toggle button */
      #toggle-btn{
        width:56px;height:56px;border-radius:50%;background:${color};
        border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;
        box-shadow:0 4px 16px rgba(0,0,0,0.25);transition:transform 0.2s;
      }
      #toggle-btn:hover{transform:scale(1.08);}
      #toggle-btn svg{width:28px;height:28px;fill:#fff;}

      /* Chat window */
      #chat-window{
        position:absolute;bottom:68px;left:0;
        width:320px;height:480px;
        background:#fff;border-radius:16px;
        box-shadow:0 8px 32px rgba(0,0,0,0.18);
        display:flex;flex-direction:column;overflow:hidden;
        direction:rtl;
        opacity:0;transform:translateY(12px) scale(0.97);
        pointer-events:none;
        transition:opacity 0.22s ease, transform 0.22s ease;
      }
      #chat-window.open{
        opacity:1;transform:translateY(0) scale(1);
        pointer-events:all;
      }

      /* Header */
      #chat-header{
        background:${color};
        padding:14px 16px;
        display:flex;align-items:center;justify-content:space-between;
        color:#fff;
      }
      #chat-header-name{font-size:15px;font-weight:600;}
      #close-btn{
        background:none;border:none;color:#fff;cursor:pointer;
        font-size:20px;line-height:1;padding:2px 6px;border-radius:4px;
        transition:background 0.15s;
      }
      #close-btn:hover{background:rgba(255,255,255,0.2);}

      /* Messages area */
      #messages{
        flex:1;overflow-y:auto;padding:14px 12px;
        display:flex;flex-direction:column;gap:8px;
        background:#f7f8fa;
      }
      #messages::-webkit-scrollbar{width:4px;}
      #messages::-webkit-scrollbar-thumb{background:#d0d4db;border-radius:4px;}

      /* Bubbles */
      .msg{
        max-width:80%;padding:9px 13px;border-radius:14px;
        font-size:14px;line-height:1.5;word-break:break-word;
      }
      .msg.bot{
        background:#fff;color:#1a1a2e;border-bottom-right-radius:4px;
        align-self:flex-end;
        box-shadow:0 1px 4px rgba(0,0,0,0.08);
      }
      .msg.user{
        background:${color};color:#fff;border-bottom-left-radius:4px;
        align-self:flex-start;
      }

      /* Typing indicator */
      #typing{display:none;align-self:flex-end;}
      #typing.show{display:flex;}
      #typing .dots{display:flex;gap:4px;padding:10px 14px;background:#fff;border-radius:14px;border-bottom-right-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,0.08);}
      #typing .dot{width:7px;height:7px;background:#aaa;border-radius:50%;animation:bounce 1.2s infinite;}
      #typing .dot:nth-child(2){animation-delay:0.2s;}
      #typing .dot:nth-child(3){animation-delay:0.4s;}
      @keyframes bounce{0%,60%,100%{transform:translateY(0);}30%{transform:translateY(-6px);}}

      /* Input area */
      #input-area{
        display:flex;align-items:center;gap:8px;
        padding:10px 12px;border-top:1px solid #e8eaf0;background:#fff;
      }
      #user-input{
        flex:1;border:1px solid #d0d4db;border-radius:20px;
        padding:9px 14px;font-size:14px;outline:none;
        direction:rtl;resize:none;
        transition:border-color 0.15s;
        font-family:inherit;
      }
      #user-input:focus{border-color:${color};}
      #send-btn{
        width:38px;height:38px;border-radius:50%;
        background:${color};border:none;cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        transition:opacity 0.15s;flex-shrink:0;
      }
      #send-btn:hover{opacity:0.85;}
      #send-btn svg{width:18px;height:18px;fill:#fff;}
      #send-btn:disabled{opacity:0.45;cursor:not-allowed;}

      /* Powered by */
      #powered{
        text-align:center;padding:4px;font-size:10px;color:#bbb;background:#fff;
        border-top:1px solid #f0f0f0;
      }

      @media(max-width:420px){
        #chat-window{width:calc(100vw - 32px);left:0;}
      }
    `;

    // ── HTML structure ──
    const container = document.createElement('div');
    container.innerHTML = `
      <div id="chat-window">
        <div id="chat-header">
          <span id="chat-header-name">${escapeHtml(name)}</span>
          <button id="close-btn" aria-label="סגור">✕</button>
        </div>
        <div id="messages"></div>
        <div id="typing"><div class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div></div>
        <div id="input-area">
          <button id="send-btn" aria-label="שלח">
            <svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
          </button>
          <input id="user-input" type="text" placeholder="כתוב הודעה..." autocomplete="off" />
        </div>
        <div id="powered">מופעל ע"י Binai AI</div>
      </div>
      <button id="toggle-btn" aria-label="פתח צ'אט">
        <svg viewBox="0 0 24 24"><path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 12H6l-2 2V4h16v10z"/></svg>
      </button>
    `;

    shadow.appendChild(style);
    shadow.appendChild(container);

    // Move typing into messages (needs to be inside for ordering)
    const messagesEl = shadow.getElementById('messages');
    const typingEl = shadow.getElementById('typing');
    messagesEl.appendChild(typingEl);

    const chatWindow = shadow.getElementById('chat-window');
    const toggleBtn = shadow.getElementById('toggle-btn');
    const closeBtn = shadow.getElementById('close-btn');
    const userInput = shadow.getElementById('user-input');
    const sendBtn = shadow.getElementById('send-btn');

    let history = [];
    let isOpen = false;
    let isWaiting = false;

    // Show greeting on first open
    function openChat() {
      isOpen = true;
      chatWindow.classList.add('open');
      if (history.length === 0) {
        addMessage('bot', greeting);
      }
      setTimeout(function () { userInput.focus(); }, 250);
    }

    function closeChat() {
      isOpen = false;
      chatWindow.classList.remove('open');
    }

    toggleBtn.addEventListener('click', function () {
      isOpen ? closeChat() : openChat();
    });
    closeBtn.addEventListener('click', closeChat);

    function addMessage(role, text) {
      const div = document.createElement('div');
      div.className = 'msg ' + role;
      div.textContent = text;
      messagesEl.insertBefore(div, typingEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function setTyping(show) {
      typingEl.className = show ? 'show' : '';
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    async function sendMessage() {
      if (isWaiting) return;
      const msg = userInput.value.trim();
      if (!msg) return;

      userInput.value = '';
      addMessage('user', msg);
      isWaiting = true;
      sendBtn.disabled = true;
      setTyping(true);

      try {
        const resp = await fetch(BASE_URL + '/api/widget-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessId, message: msg, history })
        });
        const data = await resp.json();
        setTyping(false);

        if (data.response) {
          history.push({ role: 'user', content: msg });
          history.push({ role: 'assistant', content: data.response });
          if (history.length > 20) history = history.slice(-20);
          addMessage('bot', data.response);
        } else {
          addMessage('bot', 'מצטערים, אירעה שגיאה. נסה שוב.');
        }
      } catch (e) {
        setTyping(false);
        addMessage('bot', 'מצטערים, אין חיבור לשרת כרגע.');
      }

      isWaiting = false;
      sendBtn.disabled = false;
      userInput.focus();
    }

    sendBtn.addEventListener('click', sendMessage);
    userInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();
