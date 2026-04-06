/**
 * wallet.js — MetaMask Wallet Connection
 *
 * ─────────────────────────────────────────────────────────────
 *  LLD STRUCTURE
 * ─────────────────────────────────────────────────────────────
 *  1. STATE LAYER          — mutable runtime state + static lookup
 *  2. UTILITY HELPERS      — pure functions, zero side-effects
 *  3. ETHEREUM / RPC LAYER — all window.ethereum calls
 *  4. UI UPDATE LAYER      — DOM writers (data-in → render-out)
 *  5. ACTION LAYER         — controller entry-points (user actions)
 *  6. EVENT LISTENERS      — MetaMask provider subscriptions
 *  7. LIFECYCLE            — IIFE init, session-restore
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   1. STATE LAYER
   ─ All mutable state lives here. Nothing else mutates global vars.
═══════════════════════════════════════════════════════════════ */

const State = (() => {
  let _fullAddress = '';
  let _isConnecting = false;

  const f = {
    '0x1': 'Ethereum',
    '0x5': 'Goerli',
    '0xaa36a7': 'Sepolia',
    '0x89': 'Polygon',
    '0xa': 'Optimism',
    '0xa4b1': 'Arbitrum',
    '0x38': 'BNB Chain',
    '0xa86a': 'Avalanche',
    '0x61c': 'Linea Sepolia',
    '0x4842': 'MegaETH'
  };

  return {
    get fullAddress() { return _fullAddress; },
    set fullAddress(v) { _fullAddress = v; },

    get isConnecting() { return _isConnecting; },
    set isConnecting(v) { _isConnecting = v; },

    getNetworkLabel(chainId) {
      return NETWORK_NAMES[chainId] ?? ('Chain ' + parseInt(chainId, 16));
    },
  };
})();


/* ═══════════════════════════════════════════════════════════════
   2. UTILITY HELPERS
   ─ Pure functions. No DOM access. No State mutation.
═══════════════════════════════════════════════════════════════ */

const Utils = (() => {
  /** Shorten 0x address → 0x1234…abcd */
  function fmtAddress(addr) {
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  /** HH:MM:SS timestamp */
  function timestamp() {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(n => String(n).padStart(2, '0'))
      .join(':');
  }

  /** Clamp a number to fixed decimal places */
  function toFixed(num, decimals = 4) {
    return Number(num).toFixed(decimals);
  }

  /** Hex wei → ETH number */
  function hexWeiToEth(hexWei) {
    return parseInt(hexWei, 16) / 1e18;
  }

  return { fmtAddress, timestamp, toFixed, hexWeiToEth };
})();


/* ═══════════════════════════════════════════════════════════════
   3. ETHEREUM / RPC LAYER
   ─ All window.ethereum.request() calls.
   ─ Returns raw data; does NOT touch the DOM or State.
═══════════════════════════════════════════════════════════════ */

const EthRPC = (() => {
  function isAvailable() {
    return typeof window !== 'undefined' && Boolean(window.ethereum);
  }

  async function requestAccounts() {
    return window.ethereum.request({ method: 'eth_requestAccounts' });
  }

  async function getAccounts() {
    return window.ethereum.request({ method: 'eth_accounts' });
  }

  async function getChainId() {
    return window.ethereum.request({ method: 'eth_chainId' });
  }

  async function getBalance(address) {
    const hex = await window.ethereum.request({
      method: 'eth_getBalance',
      params: [address, 'latest'],
    });
    return Utils.toFixed(Utils.hexWeiToEth(hex));
  }

  function onAccountsChanged(handler) {
    window.ethereum.removeAllListeners?.('accountsChanged');
    window.ethereum.on('accountsChanged', handler);
  }

  function onChainChanged(handler) {
    window.ethereum.removeAllListeners?.('chainChanged');
    window.ethereum.on('chainChanged', handler);
  }

  return {
    isAvailable,
    requestAccounts,
    getAccounts,
    getChainId,
    getBalance,
    onAccountsChanged,
    onChainChanged,
  };
})();


/* ═══════════════════════════════════════════════════════════════
   4. UI UPDATE LAYER
   ─ Functions that write to the DOM.
   ─ Accept data as arguments; do not fetch data themselves.
═══════════════════════════════════════════════════════════════ */

const UI = (() => {
  /* ── Element refs (lazy, cached on first call) ── */
  const el = (id) => document.getElementById(id);

  /* ── Toast ── */
  function showToast(msg, type = 'success') {
    const t = el('toast');
    t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'toast'; }, 2500);
  }

  /* ── Event log ── */
  function addLog(msg, type = '') {
    const log = el('eventLog');
    const placeholder = log.querySelector('.log-msg:not([class*="event-"])');
    if (placeholder?.textContent === 'Awaiting events…') log.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'log-item';
    row.innerHTML =
      `<span class="log-time">${Utils.timestamp()}</span>` +
      `<span class="log-msg ${type}">${msg}</span>`;
    log.insertBefore(row, log.firstChild);
    while (log.children.length > 10) log.removeChild(log.lastChild);
  }

  /* ── Wallet info fields ── */
  function setAddress(addr) {
    el('displayAddress').textContent = Utils.fmtAddress(addr);
  }

  function setNetwork(chainId) {
    const label = State.getNetworkLabel(chainId);
    el('chainId').textContent = parseInt(chainId, 16);
    el('networkName').textContent = label;
    el('networkBadge').className = 'network-badge connected';
    el('networkDot').className = 'network-dot active';
    return label;
  }

  function setBalance(value) {
    el('balanceDisplay').textContent = value;
  }

  /* ── View switches ── */
  function showConnected() {
    el('disconnectedView').classList.add('hidden');
    const cv = el('connectedView');
    cv.classList.remove('hidden');
    cv.classList.add('fade-in');
    el('foxWrap').classList.remove('pulse');
  }

  function showDisconnected() {
    el('connectedView').classList.add('hidden');
    el('disconnectedView').classList.remove('hidden');
    el('networkBadge').className = 'network-badge';
    el('networkDot').className = 'network-dot';
    el('networkName').textContent = 'Not connected';
  }

  /* ── Connect button states ── */
  function setConnectButtonLoading(btn) {
    btn._originalHTML = btn.innerHTML;
    btn.innerHTML = '<div class="spinner"></div><span>Connecting…</span>';
    btn.disabled = true;
    el('foxWrap').classList.add('pulse');
  }

  function resetConnectButton(btn) {
    btn.innerHTML = btn._originalHTML;
    btn.disabled = false;
    el('foxWrap').classList.remove('pulse');
  }

  /* ── Install prompt ── */
  function showInstallPrompt() {
    el('heroSub').textContent =
      'MetaMask not detected. Install it to continue.';
    el('connectBtn').classList.add('hidden');
    el('installBtn').classList.remove('hidden');
  }

  /* ── Copy button feedback ── */
  function setCopyButtonCopied() {
    const btn = el('copyBtn');
    btn.className = 'copy-btn copied';
    btn.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>' +
      '</svg>';
    return btn;
  }

  function resetCopyButton(btn) {
    btn.className = 'copy-btn';
    btn.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>' +
      '</svg>';
  }

  return {
    showToast,
    addLog,
    setAddress,
    setNetwork,
    setBalance,
    showConnected,
    showDisconnected,
    setConnectButtonLoading,
    resetConnectButton,
    showInstallPrompt,
    setCopyButtonCopied,
    resetCopyButton,
  };
})();


/* ═══════════════════════════════════════════════════════════════
   5. ACTION LAYER  (Controller entry-points)
   ─ Orchestrates EthRPC + UI + State.
   ─ Called directly from HTML event handlers.
═══════════════════════════════════════════════════════════════ */

const Actions = (() => {
  /** Populate all connected-state fields (address + chain + balance) */
  async function _applyConnectedState(address, chainId) {
    State.fullAddress = address;
    UI.setAddress(address);
    UI.setNetwork(chainId);
    UI.setBalance('Loading…');
    const bal = await EthRPC.getBalance(address).catch(() => '—');
    UI.setBalance(bal);
  }

  /** Connect to MetaMask */
  async function handleConnect() {
    if (State.isConnecting) return;

    if (!EthRPC.isAvailable()) {
      UI.showInstallPrompt();
      UI.showToast('MetaMask not found', 'error');
      return;
    }

    State.isConnecting = true;
    const btn = document.getElementById('connectBtn');
    UI.setConnectButtonLoading(btn);

    try {
      const accounts = await EthRPC.requestAccounts();
      if (!accounts.length) throw new Error('No accounts returned.');

      const chainId = await EthRPC.getChainId();
      await _applyConnectedState(accounts[0], chainId);
      UI.showConnected();
      UI.addLog('Wallet connected: ' + Utils.fmtAddress(accounts[0]), 'event-connect');
      UI.showToast('Wallet connected!', 'success');
      EventListeners.setup();

    } catch (err) {
      if (err.code === 4001) {
        UI.showToast('Connection rejected', 'error');
      } else {
        UI.showToast('Connection failed', 'error');
        console.error('[WalletLink] connect error:', err);
      }
    } finally {
      UI.resetConnectButton(btn);
      State.isConnecting = false;
    }
  }

  /** Disconnect wallet (client-side only — MetaMask has no programmatic disconnect) */
  function handleDisconnect() {
    State.fullAddress = '';
    UI.showDisconnected();
    UI.addLog('Wallet disconnected', 'event-disconnect');
    UI.showToast('Disconnected', 'warn');
  }

  /** Copy full address to clipboard */
  async function copyAddress() {
    if (!State.fullAddress) return;
    try {
      await navigator.clipboard.writeText(State.fullAddress);
      const btn = UI.setCopyButtonCopied();
      UI.showToast('Address copied!', 'success');
      setTimeout(() => UI.resetCopyButton(btn), 2000);
    } catch (err) {
      console.error('[WalletLink] clipboard error:', err);
    }
  }

  /** Open MetaMask download page */
  function openInstall() {
    window.open('https://metamask.io/download/', '_blank');
  }

  return { handleConnect, handleDisconnect, copyAddress, openInstall };
})();


/* ═══════════════════════════════════════════════════════════════
   6. EVENT LISTENERS
   ─ MetaMask provider subscriptions.
   ─ Each handler delegates to Actions or UI; no logic lives here.
═══════════════════════════════════════════════════════════════ */

const EventListeners = (() => {
  async function _onAccountsChanged(accounts) {
    if (!accounts.length) {
      Actions.handleDisconnect();
      return;
    }
    const chainId = await EthRPC.getChainId();
    State.fullAddress = accounts[0];
    UI.setAddress(accounts[0]);
    UI.setNetwork(chainId);
    UI.setBalance('Loading…');
    const bal = await EthRPC.getBalance(accounts[0]).catch(() => '—');
    UI.setBalance(bal);
    UI.addLog('Account changed → ' + Utils.fmtAddress(accounts[0]), 'event-account');
    UI.showToast('Account switched', 'warn');
  }

  async function _onChainChanged(chainId) {
    const netLabel = UI.setNetwork(chainId);
    if (State.fullAddress) {
      UI.setBalance('Loading…');
      const bal = await EthRPC.getBalance(State.fullAddress).catch(() => '—');
      UI.setBalance(bal);
    }
    UI.addLog('Network changed → ' + netLabel, 'event-network');
    UI.showToast('Switched to ' + netLabel, 'warn');
  }

  /** Attach listeners (removes duplicates first via EthRPC wrappers) */
  function setup() {
    if (!EthRPC.isAvailable()) return;
    EthRPC.onAccountsChanged(_onAccountsChanged);
    EthRPC.onChainChanged(_onChainChanged);
  }

  return { setup };
})();


/* ═══════════════════════════════════════════════════════════════
   7. LIFECYCLE — IIFE
   ─ Session restore on page load (non-prompting).
   ─ Wires up global onclick handlers for HTML buttons.
═══════════════════════════════════════════════════════════════ */

(async function init() {
  /* Expose action handlers to HTML onclick attributes */
  window.handleConnect = Actions.handleConnect;
  window.handleDisconnect = Actions.handleDisconnect;
  window.copyAddress = Actions.copyAddress;
  window.openInstall = Actions.openInstall;

  /* Attempt silent session restore — no approval prompt */
  if (!EthRPC.isAvailable()) return;

  try {
    const accounts = await EthRPC.getAccounts();
    if (!accounts.length) return;

    const chainId = await EthRPC.getChainId();
    State.fullAddress = accounts[0];
    UI.setAddress(accounts[0]);
    UI.setNetwork(chainId);
    UI.setBalance('Loading…');
    const bal = await EthRPC.getBalance(accounts[0]).catch(() => '—');
    UI.setBalance(bal);
    UI.showConnected();
    UI.addLog('Session restored: ' + Utils.fmtAddress(accounts[0]), 'event-connect');
    EventListeners.setup();
  } catch (err) {
    console.error('[WalletLink] session restore error:', err);
  }
})();
