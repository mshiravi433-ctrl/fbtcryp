/**
 * FBT INTENT AI — Mode A (Human ↔ AI) panel.
 * ---------------------------------------------------------------------------
 * Lightweight UI for the Phase-1 Foundation:
 *   - Level selector (L1 / L2 / L3)
 *   - L3 policy confirm preview (CONFIRM & START / CANCEL)
 *   - chat-style input against a local startSession / chatTurn session
 *   - analysis, prepared-draft, ready-for-confirmation, clarification replies
 *   - emergency stop
 *
 * This panel does NOT sign anything and does not call any broker or wallet.
 * It produces draft orders + termsHash that downstream (Phase 2) execution
 * screens will consume after the Confirmation Gate.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { riseIn } from './PageTransition';
import {
  startSession, chatTurn, confirmSessionPolicy, userStop,
  describeLevel, policyPreview, confirmationSummary, INTENT_AI_VERSION
} from '../lib/intent-ai';

const LEVELS = [
  { value: 1, key: 'level1', title: 'Analysis' },
  { value: 2, key: 'level2', title: 'Prepare' },
  { value: 3, key: 'level3', title: 'Controlled Autonomous' }
];

function fmtTime(ts) {
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

export default function IntentAIPanel({ defaultChainId = 42161, onDraftReady }) {
  const [level, setLevel] = useState(1);
  const [session, setSession] = useState(() => startSession({ level: 1, defaultChainId }));
  const [input, setInput] = useState('');
  const [policyInput, setPolicyInput] = useState({
    maxCapitalUsd: 1000,
    maxTransactionUsd: 200,
    maxLossUsd: 100,
    maxLeverage: 2,
    allowedChains: '42161,8453',
    allowedProtocols: 'swap',
    allowedAssets: 'USDC,ETH,BTC',
    durationMin: 60
  });

  useEffect(() => {
    // Reset session whenever level changes.
    const s = startSession({
      level,
      defaultChainId,
      policyInput: level === 3 ? buildPolicy(policyInput) : null
    });
    setSession(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  function buildPolicy(p) {
    return {
      maxCapitalUsd: Number(p.maxCapitalUsd) || 0,
      maxTransactionUsd: Number(p.maxTransactionUsd) || 0,
      maxLossUsd: Number(p.maxLossUsd) || 0,
      maxLeverage: Number(p.maxLeverage) || 1,
      allowedChains: String(p.allowedChains || '').split(',').map((s) => Number(s.trim())).filter(Boolean),
      allowedProtocols: String(p.allowedProtocols || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      allowedAssets: String(p.allowedAssets || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
      durationMs: (Number(p.durationMin) || 60) * 60 * 1000
    };
  }

  function handleSend(e) {
    e?.preventDefault();
    if (!input.trim()) return;
    const text = input.trim();
    setInput('');
    const next = { ...session };
    const { session: after } = chatTurn(next, text, { defaultChainId });
    setSession(after);
  }

  function handleConfirmPolicy() {
    const s = startSession({ level: 3, defaultChainId, policyInput: buildPolicy(policyInput) });
    const { session: confirmed } = confirmSessionPolicy(s);
    setSession(confirmed);
  }

  function handleCancelPolicy() {
    setLevel(1);
  }

  function handleEmergencyStop() {
    const stopped = userStop(session);
    setSession(stopped);
  }

  const msgs = session?.messages || [];
  const preview = session?.policy ? policyPreview(session.policy) : null;
  const l3NeedsConfirm = level === 3 && session?.policy && !session.policy.userConfirmed;
  const canExecute = level >= 3 && session?.policy?.userConfirmed;

  const visibleMessages = useMemo(() => {
    return msgs.filter((m) => m.role !== 'system' || !/^(session\.started|policy\.confirmed)$/.test(m.type));
  }, [msgs]);

  return (
    <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
      <p className="section-label" style={{ marginBottom: 6 }}>FBT Intent AI</p>
      <p className="muted" style={{ fontSize: 12.2, margin: '0 0 10px', lineHeight: 1.7 }}>
        Deterministic intent parser · {describeLevel(level).summary} · v{INTENT_AI_VERSION}
      </p>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {LEVELS.map((L) => (
          <button
            key={L.key}
            type="button"
            className={`chip ${level === L.value ? 'chip-on' : ''}`}
            onClick={() => setLevel(L.value)}
            aria-pressed={level === L.value}
          >
            L{L.value} · {L.title}
          </button>
        ))}
      </div>

      {session?.status === 'STOPPED' && (
        <p className="notice" style={{ color: 'var(--bad, #ff6b6b)' }}>
          Emergency stop is active. No execution is possible.
        </p>
      )}

      {l3NeedsConfirm && preview && (
        <div className="card-inner" style={{ background: 'rgba(255,255,255,0.04)', padding: 12, borderRadius: 10, marginBottom: 10 }}>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>Confirm autonomous-session policy before starting:</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
            <li><b>Level:</b> {preview.level}</li>
            <li><b>Max capital:</b> {preview.maximumCapital}</li>
            <li><b>Max per transaction:</b> {preview.maximumTransaction}</li>
            <li><b>Max loss:</b> {preview.maximumLoss}</li>
            <li><b>Max leverage:</b> {preview.maximumLeverage}</li>
            <li><b>Allowed chains:</b> {preview.allowedChains}</li>
            <li><b>Allowed protocols:</b> {preview.allowedProtocols}</li>
            <li><b>Allowed assets:</b> {preview.allowedAssets}</li>
            <li><b>Duration:</b> {preview.duration}</li>
            <li><b>Exit policy:</b> {preview.exitPolicy}</li>
            <li><b>Emergency stop:</b> {preview.emergencyStop}</li>
          </ul>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button type="button" className="btn btn-primary" onClick={handleConfirmPolicy}>CONFIRM &amp; START</button>
            <button type="button" className="btn" onClick={handleCancelPolicy}>CANCEL</button>
          </div>
        </div>
      )}

      {level === 3 && !l3NeedsConfirm && (
        <details style={{ marginBottom: 10, fontSize: 12 }}>
          <summary className="muted">Session policy settings</summary>
          <div className="grid-2" style={{ gap: 8, marginTop: 8 }}>
            <label className="field">
              <span className="field-label">Max capital (USD)</span>
              <input type="number" value={policyInput.maxCapitalUsd}
                onChange={(e) => setPolicyInput({ ...policyInput, maxCapitalUsd: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Max per tx (USD)</span>
              <input type="number" value={policyInput.maxTransactionUsd}
                onChange={(e) => setPolicyInput({ ...policyInput, maxTransactionUsd: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Max loss (USD)</span>
              <input type="number" value={policyInput.maxLossUsd}
                onChange={(e) => setPolicyInput({ ...policyInput, maxLossUsd: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Max leverage (x)</span>
              <input type="number" value={policyInput.maxLeverage}
                onChange={(e) => setPolicyInput({ ...policyInput, maxLeverage: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Allowed chains (csv)</span>
              <input value={policyInput.allowedChains}
                onChange={(e) => setPolicyInput({ ...policyInput, allowedChains: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Allowed protocols (csv)</span>
              <input value={policyInput.allowedProtocols}
                onChange={(e) => setPolicyInput({ ...policyInput, allowedProtocols: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Allowed assets (csv)</span>
              <input value={policyInput.allowedAssets}
                onChange={(e) => setPolicyInput({ ...policyInput, allowedAssets: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Duration (minutes)</span>
              <input type="number" value={policyInput.durationMin}
                onChange={(e) => setPolicyInput({ ...policyInput, durationMin: e.target.value })} />
            </label>
          </div>
          <button type="button" className="btn" style={{ marginTop: 8 }}
            onClick={() => {
              const s = startSession({ level: 3, defaultChainId, policyInput: buildPolicy(policyInput) });
              setSession(s);
            }}>
            Apply policy (unconfirmed)
          </button>
        </details>
      )}

      <div className="intent-ai-thread" style={{
        maxHeight: 360, overflowY: 'auto', padding: 8, borderRadius: 10,
        background: 'rgba(255,255,255,0.03)', marginBottom: 10
      }}>
        {visibleMessages.length === 0 && (
          <p className="muted" style={{ fontSize: 12 }}>
            Try: <i>"swap 100 USDC to ETH on Arbitrum"</i>, <i>"analyze BTC"</i>, or <i>"target 10% on 500 USDC in 4 hours"</i>.
          </p>
        )}
        {visibleMessages.map((m) => (
          <MessageBubble key={m.id} msg={m} onDraftReady={onDraftReady} />
        ))}
      </div>

      <form onSubmit={handleSend} className="row" style={{ gap: 8 }}>
        <input
          className="field-input"
          placeholder={canExecute ? 'Ask Intent AI (L3)' : 'Ask Intent AI'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={session?.status === 'STOPPED'}
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-primary" disabled={!input.trim()}>Send</button>
        {level >= 2 && (
          <button type="button" className="btn" onClick={handleEmergencyStop}
            title="Emergency stop (irrevocable for this session)">🛑 Stop</button>
        )}
      </form>
    </motion.section>
  );
}

function MessageBubble({ msg, onDraftReady }) {
  const role = msg.role;
  const isUser = role === 'user';
  const bubble = {
    padding: '8px 10px',
    borderRadius: 12,
    margin: '4px 0',
    maxWidth: '92%',
    fontSize: 12.5,
    lineHeight: 1.55,
    background: isUser ? 'rgba(0,229,255,0.12)' : 'rgba(255,255,255,0.06)',
    alignSelf: isUser ? 'flex-end' : 'flex-start',
    marginLeft: isUser ? 'auto' : 0,
    marginRight: isUser ? 0 : 'auto'
  };
  return (
    <div style={bubble}>
      <div className="row-between" style={{ marginBottom: 3 }}>
        <span className="faint" style={{ fontSize: 10.5 }}>{isUser ? 'you' : 'fbt.ai'}</span>
        <span className="faint" style={{ fontSize: 10.5 }}>{fmtTime(msg.ts)}</span>
      </div>
      <MessageContent msg={msg} onDraftReady={onDraftReady} />
    </div>
  );
}

function MessageContent({ msg, onDraftReady }) {
  if (msg.role === 'user') return <span>{msg.text}</span>;
  const { type, payload = {} } = msg;

  if (type === 'clarifications-needed') {
    return (
      <div>
        <span>A few things are unclear:</span>
        <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
          {(payload.clarifications || []).map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
    );
  }
  if (type === 'analysis') {
    const { intent, suggestions = [], confidence } = payload;
    return (
      <div>
        <div><b>Intent:</b> {intent?.action} · conf {confidence}%</div>
        {suggestions.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <b>Suggestions:</b>
            <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
              {suggestions.slice(0, 3).map((s) => <li key={s.id}>{s.strategy} — {s.description}</li>)}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (type === 'prepared-draft' || type === 'ready-for-confirmation') {
    const { selectedStrategy, plan, drafts = [], termsHash, level } = payload;
    return (
      <div>
        <div><b>{type === 'ready-for-confirmation' ? 'Ready for confirmation' : 'Draft prepared'}</b> (L{level})</div>
        {selectedStrategy && <div className="faint" style={{ marginTop: 2 }}>Strategy: {selectedStrategy.strategy} — {selectedStrategy.description}</div>}
        {plan?.steps?.map((s) => (
          <div key={s.seq} style={{ marginTop: 4 }}>
            • step {s.seq}: <b>{s.action}</b> {s.fromSymbol || ''}{s.toSymbol ? ` → ${s.toSymbol}` : ''} on chain {s.chainId || s.fromChain}
          </div>
        ))}
        {drafts.length > 0 && <div className="faint" style={{ marginTop: 4 }}>{drafts.length} draft order(s) · terms {termsHash?.slice(0, 8)}</div>}
        {type === 'ready-for-confirmation' && (
          <button type="button" className="btn btn-primary" style={{ marginTop: 6 }}
            onClick={() => onDraftReady?.({ plan, drafts, termsHash })}>
            Open confirmation gate
          </button>
        )}
      </div>
    );
  }
  if (type === 'unable-to-proceed') {
    return (
      <div>
        <div style={{ color: 'var(--warn, #ffb454)' }}>Cannot proceed:</div>
        <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
          {(payload.reasons || []).slice(0, 6).map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>
    );
  }
  if (type === 'policy-confirmation-required') {
    return <div>Please confirm the session policy in the panel above.</div>;
  }
  return <span>{type}</span>;
}
