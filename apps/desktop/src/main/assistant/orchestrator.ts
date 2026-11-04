import { randomUUID } from 'node:crypto';
import type { DeepPartial, Settings } from '@shared/settings';
import type { AssistantEvent, AssistantReply, ExpressionStyle, Routine, SpeechServiceStatus } from '@shared/types';
import type { Repos } from '../storage/repos';
import type { ToolExecutor, ToolRegistry } from '../tools/executor';
import type { ConfirmationBroker } from '../tools/confirmations';
import { ToolError, type Platform, type SessionState, type ToolContext, type ToolResult } from '../tools/types';
import type { WindowsBridge } from '../windows/bridge';
import type { ProviderManager } from '../providers/manager';
import { POLICY_LABELS } from '../providers/manager';
import { ProviderError, type ConversationItem, type LlmProvider } from '../providers/types';
import type { Builtin, PendingSlot, Resolution } from './catalog';
import { route } from './router';
import { chooseStyle, greetingFor, phrase, PROFILES, systemPrompt, toSpeech, type Situation } from './style';
import { redact } from '../security/redact';

export interface AssistantDeps {
  repos: Repos;
  registry: ToolRegistry;
  executor: ToolExecutor;
  broker: ConfirmationBroker;
  bridge: WindowsBridge;
  platform: Platform;
  providers: ProviderManager;
  scheduler: ToolContext['scheduler'];
  emit(ev: AssistantEvent): void;
  settings(): Settings;
  updateSettings(patch: DeepPartial<Settings>): Settings;
  speechStatus(): SpeechServiceStatus;
  uiCommand(cmd: string, payload?: unknown): void;
}

/** Tools the model may never call by itself: memory changes must come from the user's own words. */
const LLM_EXCLUDED = new Set(['memory.save', 'memory.forget']);
const MAX_TOOL_ROUNDS = 6;

interface Outcome { text: string; speech?: string; situation: Situation; expectFollowUp?: boolean; source?: AssistantReply['source']; providerLabel?: string }

export class Assistant {
  readonly session: SessionState = {};
  private items: ConversationItem[] = [];
  private conversationId: string | null = null;
  private pending: PendingSlot | null = null;
  private current: AbortController | null = null;
  private lastReply: AssistantReply | null = null;

  constructor(private d: AssistantDeps) {}

  get busy() { return this.current !== null; }

  private ctx(signal: AbortSignal): ToolContext {
    return { settings: this.d.settings(), bridge: this.d.bridge, repos: this.d.repos, platform: this.d.platform, signal, session: this.session, scheduler: this.d.scheduler };
  }

  private persist(role: 'user' | 'assistant', text: string, meta?: Record<string, unknown>) {
    if (!this.d.settings().privacy.saveHistory || !text) return;
    if (!this.conversationId) this.conversationId = this.d.repos.conversations.create(text.slice(0, 60));
    this.d.repos.conversations.add(this.conversationId, role, redact(text), meta);
  }

  async submit(text: string, source: 'text' | 'voice'): Promise<AssistantReply> {
    // New input supersedes whatever was in flight.
    if (this.current) this.cancel(false);
    const controller = new AbortController();
    this.current = controller;
    const turnId = randomUUID().slice(0, 12);
    this.d.emit({ type: 'user', turnId, text, source });
    this.d.emit({ type: 'phase', phase: 'processing' });
    this.persist('user', text, { source });
    this.session.lastUserText = text;

    let outcome: Outcome;
    try {
      outcome = await this.handle(text, source, turnId, controller.signal);
    } catch (e) {
      const cancelled = controller.signal.aborted || (e instanceof ToolError && e.code === 'cancelled') || (e instanceof ProviderError && e.code === 'cancelled');
      outcome = cancelled ? { text: phrase('cancelled', this.d.settings()), situation: 'info' } : { text: `Sorry, something went wrong: ${(e as Error).message}`, situation: 'failure' };
    } finally {
      if (this.current === controller) this.current = null;
    }
    const s = this.d.settings();
    const reply: AssistantReply = {
      turnId,
      text: outcome.text,
      speech: outcome.speech ?? toSpeech(outcome.text, s.personality.verbosity === 'detailed' ? 1200 : 600),
      style: chooseStyle(s, outcome.situation) as ExpressionStyle,
      source: outcome.source ?? 'deterministic',
      providerLabel: outcome.providerLabel,
      expectFollowUp: outcome.expectFollowUp ?? s.listening.mode === 'conversation',
    };
    if (reply.text) {
      this.lastReply = reply;
      this.session.lastSpoken = reply.speech;
      this.persist('assistant', reply.text, { source: reply.source });
    }
    this.d.emit({ type: 'reply', reply });
    this.d.emit({ type: 'phase', phase: 'idle' });
    return reply;
  }

  cancel(announce = true) {
    this.current?.abort();
    this.current = null;
    this.pending = null;
    this.d.broker.cancelAll();
    if (announce) this.d.emit({ type: 'phase', phase: 'idle' });
  }

  emergencyStop() {
    this.cancel();
    this.d.emit({ type: 'speech_control', action: 'stop' });
    this.d.uiCommand('mic_mute');
    this.d.emit({ type: 'notice', level: 'warn', text: 'Emergency stop: all actions cancelled, speech stopped and microphone muted.' });
  }

  newSession() {
    this.cancel(false);
    this.items = [];
    this.conversationId = null;
    this.pending = null;
    for (const k of Object.keys(this.session)) delete this.session[k];
    this.d.emit({ type: 'session_reset' });
  }

  private async handle(text: string, source: 'text' | 'voice', turnId: string, signal: AbortSignal): Promise<Outcome> {
    const ctx = this.ctx(signal);
    const routed = route(text, { session: this.session, apps: this.d.repos.apps.list() }, this.d.repos.routines.list(), this.pending);
    this.pending = null;

    if (routed.kind === 'routine') return this.runRoutine(routed.routine, ctx, turnId);

    if (routed.kind === 'commands') {
      const outputs: Outcome[] = [];
      for (const step of routed.steps) {
        if (signal.aborted) throw new ToolError('Cancelled.', 'cancelled');
        outputs.push(await this.resolve(step.resolution, ctx, turnId, step.commandId));
      }
      if (outputs.length === 1) {
        // Track conversational context so follow-up questions can refer back to what just happened.
        this.items.push({ role: 'user', text }, { role: 'assistant', text: outputs[0].text });
        this.trimContext();
        return outputs[0];
      }
      const combined = outputs.map((o) => o.text).join(' ');
      this.items.push({ role: 'user', text }, { role: 'assistant', text: combined });
      this.trimContext();
      return { text: combined, situation: outputs.some((o) => o.situation === 'failure') ? 'failure' : 'success', expectFollowUp: outputs.some((o) => o.expectFollowUp) };
    }

    return this.converse(text, source, ctx, turnId);
  }

  private async resolve(r: Resolution, ctx: ToolContext, turnId: string, commandId: string): Promise<Outcome> {
    if (r.kind === 'clarify') {
      if (r.pending) this.pending = r.pending;
      return { text: r.question, situation: 'info', expectFollowUp: true };
    }
    if (r.kind === 'builtin') return this.builtin(r.builtin, r.params ?? {}, commandId);
    return this.runTool(r.tool, r.args, ctx, turnId, 'user_command');
  }

  private async runTool(name: string, args: unknown, ctx: ToolContext, turnId: string, origin: 'user_command' | 'llm' | 'routine'): Promise<Outcome & { result?: ToolResult }> {
    this.d.emit({ type: 'phase', phase: 'executing', detail: this.d.registry.get(name)?.title });
    // A genuine backchannel: only sent if the tool is still running after a beat.
    const slow = setTimeout(() => this.d.emit({ type: 'progress', turnId, text: phrase('working', this.d.settings()) }), 1500);
    try {
      const result = await this.d.executor.execute(name, args, ctx, { origin });
      const text = result.detail && this.d.settings().personality.verbosity !== 'brief' ? `${result.message}\n\n${result.detail}` : result.message;
      return { text, speech: toSpeech(result.message), situation: result.ok ? 'success' : 'failure', result };
    } catch (e) {
      if (e instanceof ToolError && e.code === 'cancelled') throw e;
      const msg = e instanceof Error ? e.message : String(e);
      return { text: msg, situation: e instanceof ToolError && e.code === 'denied' ? 'info' : 'failure', result: { ok: false, message: msg } };
    } finally {
      clearTimeout(slow);
      this.d.emit({ type: 'phase', phase: 'processing' });
    }
  }

  private async runRoutine(routine: Routine, ctx: ToolContext, turnId: string): Promise<Outcome> {
    this.d.emit({ type: 'progress', turnId, text: `Running ${routine.name}: ${routine.steps.length} steps.` });
    const ids = routine.steps.map(() => randomUUID().slice(0, 12));
    routine.steps.forEach((s, i) => this.d.emit({ type: 'tool', call: { id: ids[i], tool: s.tool, title: s.label ?? this.d.registry.get(s.tool)?.title ?? s.tool, risk: this.d.registry.get(s.tool)?.risk ?? 3, status: 'planned', startedAt: Date.now() } }));
    const done: string[] = [];
    const failed: string[] = [];
    for (const [i, step] of routine.steps.entries()) {
      if (ctx.signal.aborted) {
        routine.steps.slice(i).forEach((s, j) => this.d.emit({ type: 'tool', call: { id: ids[i + j], tool: s.tool, title: s.label ?? s.tool, risk: 1, status: 'cancelled', startedAt: Date.now(), endedAt: Date.now() } }));
        return { text: `Stopped ${routine.name}. Finished ${done.length} of ${routine.steps.length} steps${done.length ? `: ${done.join(', ')}` : ''}.`, situation: 'info' };
      }
      const label = step.label ?? this.d.registry.get(step.tool)?.title ?? step.tool;
      const out = await this.runTool(step.tool, step.args, ctx, turnId, 'routine');
      this.d.emit({ type: 'tool', call: { id: ids[i], tool: step.tool, title: label, risk: this.d.registry.get(step.tool)?.risk ?? 3, status: out.result?.ok ? 'completed' : 'failed', detail: out.text, startedAt: Date.now(), endedAt: Date.now() } });
      (out.result?.ok ? done : failed).push(label.toLowerCase());
    }
    if (!failed.length) return { text: `${routine.name} is ready. All ${done.length} steps completed.`, situation: 'success' };
    return { text: `${routine.name} finished with problems. ${done.length} step${done.length === 1 ? '' : 's'} worked; these didn't: ${failed.join(', ')}. Check the activity panel for details.`, situation: 'failure' };
  }

  private builtin(b: Builtin, p: Record<string, unknown>, _commandId: string): Outcome {
    const s = this.d.settings();
    switch (b) {
      case 'greeting': return { text: greetingFor(s, p.when as string | undefined), situation: 'greeting', expectFollowUp: true };
      case 'presence': return { text: phrase('presence', s), situation: 'greeting', expectFollowUp: true };
      case 'how_are_you': return { text: phrase('howAreYou', s), situation: 'greeting', expectFollowUp: true };
      case 'thanks': return { text: phrase('thanks', s), situation: 'success' };
      case 'identity': return { text: `I'm ${s.assistantName}, an AI assistant running on your PC. I'm not a person, and my voice is synthetic, but I'm here to help.`, situation: 'greeting', expectFollowUp: true };
      case 'capabilities': return {
        text: `I can open your approved apps and websites, switch and arrange windows, control volume and media, check battery, memory, disk and network, set timers and reminders, search the web, and remember things you ask me to.${this.d.providers.candidates().length ? ' I can also answer questions and help with more open-ended tasks.' : " Without a language model configured, I stick to those commands."} The full list is under Commands in Settings.`,
        situation: 'explain', expectFollowUp: true };
      case 'repeat': return this.lastReply ? { text: this.lastReply.text, speech: this.lastReply.speech, situation: 'info' } : { text: "I haven't said anything yet.", situation: 'info' };
      case 'slower':
      case 'faster': {
        const rate = Math.round(Math.min(2, Math.max(0.5, s.speech.rate + (b === 'slower' ? -0.1 : 0.1))) * 100) / 100;
        this.d.updateSettings({ speech: { rate } });
        return { text: b === 'slower' ? 'Okay, I\'ll speak a little slower.' : 'Sure, a bit faster then.', situation: 'success' };
      }
      case 'stop_speaking':
        this.d.emit({ type: 'speech_control', action: 'stop' });
        return { text: '', speech: '', situation: 'info', expectFollowUp: false };
      case 'cancel':
        this.d.broker.cancelAll();
        return { text: phrase('cancelled', s), situation: 'info', expectFollowUp: false };
      case 'new_session':
        this.items = [];
        this.conversationId = null;
        this.d.emit({ type: 'session_reset' });
        return { text: 'Fresh start. What would you like to do?', situation: 'greeting', expectFollowUp: true };
      case 'continue': {
        const last = this.d.repos.conversations.list()[0];
        if (!last) return { text: "I don't have a saved conversation to continue.", situation: 'info' };
        const msgs = this.d.repos.conversations.messages(last.id).slice(-this.d.settings().ai.contextTurns * 2);
        this.items = msgs.map((m) => (m.role === 'user' ? { role: 'user', text: m.text } : { role: 'assistant', text: m.text }));
        this.conversationId = last.id;
        return { text: `Okay, picking up our last conversation: ${last.title}.`, situation: 'info', expectFollowUp: true };
      }
      case 'end_conversation': return { text: phrase('goodbye', s), situation: 'info', expectFollowUp: false };
      case 'mode': {
        const profile = p.profile as Settings['personality']['profile'];
        this.d.updateSettings({ personality: { profile, ...(profile === 'professional' ? { verbosity: 'brief', humor: 0 } : {}) } });
        return { text: profile === 'professional' ? 'Work mode on. I\'ll keep things short and focused.' : `Switched to ${PROFILES[profile].label.toLowerCase()} mode.`, situation: 'success' };
      }
      case 'verbosity':
        this.d.updateSettings({ personality: { verbosity: p.level as 'brief' | 'detailed' } });
        return { text: p.level === 'brief' ? "Got it, I'll keep it short." : "Okay, I'll go into more detail.", situation: 'success' };
      case 'status_model': {
        const st = this.d.providers.status();
        const active = this.d.providers.candidates()[0];
        const local = st.local.ready ? `The local model ${st.local.model} is ready.` : `No local model is ready${st.local.message ? `: ${st.local.message}` : '.'}`;
        return { text: `${active ? `I'm currently using ${active.label}.` : 'No language model is active, so I only handle built-in commands.'} ${local}`, situation: 'info' };
      }
      case 'status_offline': {
        const st = this.d.providers.status();
        const desc = { strict_offline: "I'm in Strict Offline mode. Nothing leaves this PC.", smart_hybrid: `I'm in Smart Hybrid mode. Commands run locally${st.cloud.allowed && st.cloud.hasKey ? ', and I use the cloud for questions when the local model is unavailable' : ', and cloud use is currently off'}.`, online_preferred: `I'm in Online Preferred mode${st.cloud.allowed && st.cloud.hasKey ? '. Questions go to the cloud model' : ", but cloud use isn't set up yet"}.` }[st.policy];
        return { text: `${desc}${st.online ? '' : ' The network is currently offline.'}`, situation: 'info' };
      }
      case 'status_mic': {
        const sp = this.d.speechStatus();
        return { text: sp.state === 'ready' ? 'The speech engine is ready. If you can see the level meter move when you talk, your microphone is working.' : `Speech recognition isn't ready: ${sp.message ?? sp.state}.`, situation: sp.state === 'ready' ? 'info' : 'failure' };
      }
      case 'shortcuts': return { text: `${s.ui.globalShortcut.replace(/\+/g, ' plus ')} shows or hides me. ${s.ui.muteShortcut.replace(/\+/g, ' plus ')} mutes the microphone. Escape stops whatever I'm doing.`, situation: 'info' };
      case 'ui': {
        if (p.setting === 'textScale') {
          const v = Math.round(Math.min(1.6, Math.max(0.8, s.ui.textScale + (p.delta as number))) * 10) / 10;
          this.d.updateSettings({ ui: { textScale: v } });
          return { text: `Text size set to ${Math.round(v * 100)} percent.`, situation: 'success' };
        }
        this.d.updateSettings({ ui: { [p.setting as string]: p.value } } as DeepPartial<Settings>);
        return { text: p.setting === 'reducedMotion' ? (p.value === 'on' ? 'Animations reduced.' : 'Animations are back on.') : p.value ? 'High contrast on.' : 'High contrast off.', situation: 'success' };
      }
      case 'mic_pause':
        this.d.uiCommand('mic_mute');
        return { text: 'Microphone paused. Click the mic button or press the mute shortcut to resume.', situation: 'info', expectFollowUp: false };
      case 'refuse_shell':
        return { text: "I can't run shell commands or scripts. That's a deliberate safety rule. I can open apps, adjust settings, and work with files in your approved folders instead.", situation: 'info' };
    }
  }

  private trimContext() {
    const max = this.d.settings().ai.contextTurns;
    let users = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].role === 'user' && ++users > max) {
        // Drop whole turns from the front; keep provider-native blocks of the retained turns unchanged.
        this.items = this.items.slice(i + 1);
        while (this.items.length && this.items[0].role !== 'user') this.items.shift();
        return;
      }
    }
  }

  private async converse(text: string, source: 'text' | 'voice', ctx: ToolContext, turnId: string): Promise<Outcome> {
    const s = this.d.settings();
    const providers = this.d.providers.candidates();
    if (!providers.length) return this.noModel(text);

    this.items.push({ role: 'user', text });
    this.trimContext();
    const tools = this.d.registry.llmTools((t) => !LLM_EXCLUDED.has(t.name) && (!t.permission || s.tools.permissions[t.permission]));
    const system = systemPrompt(s, { memories: this.d.repos.memories.list(), toolNames: tools.map((t) => t.name), policyLabel: POLICY_LABELS[s.ai.policy] });
    const snapshot = this.items.length;
    let lastError: ProviderError | null = null;

    for (const provider of providers) {
      if (provider.kind === 'cloud') this.d.emit({ type: 'notice', level: 'info', text: `Sending your ${source === 'voice' ? 'transcribed request' : 'message'} to ${provider.label}.` });
      try {
        const out = await this.llmLoop(provider, system, tools, ctx, turnId);
        this.d.providers.reportSuccess(provider.id);
        return out;
      } catch (e) {
        if (ctx.signal.aborted || (e instanceof ProviderError && e.code === 'cancelled') || (e instanceof ToolError && e.code === 'cancelled')) throw e;
        lastError = e instanceof ProviderError ? e : new ProviderError((e as Error).message, 'bad_response');
        this.d.providers.reportFailure(provider.id);
        if (provider.kind === 'cloud') this.d.providers.setCloudMessage(lastError.message);
        this.items.length = snapshot; // discard the partial exchange before trying the next provider
        if (providers.length > 1) this.d.emit({ type: 'notice', level: 'warn', text: `${provider.label} failed (${lastError.message}). Trying the next provider.` });
      }
    }
    this.items.length = snapshot - 1;
    return { text: `I couldn't get an answer: ${lastError?.message ?? 'no provider responded'}`, situation: 'failure' };
  }

  private async llmLoop(provider: LlmProvider, system: string, tools: ReturnType<ToolRegistry['llmTools']>, ctx: ToolContext, turnId: string): Promise<Outcome> {
    let finalText = '';
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const turn = await provider.chat({ system, items: this.items, tools, signal: ctx.signal, onText: (delta) => this.d.emit({ type: 'reply_delta', turnId, text: delta }) });
      this.items.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls, raw: turn.raw, rawProvider: turn.raw ? provider.id : undefined });
      if (turn.text) finalText = turn.text;
      if (!turn.toolCalls.length) {
        if (turn.stop === 'max_tokens') finalText += ' (My answer was cut off. Ask me to continue.)';
        break;
      }
      const results: Array<{ id: string; name: string; content: string; isError: boolean }> = [];
      for (const call of turn.toolCalls) {
        const def = this.d.registry.fromLlmName(call.name);
        if (!def || LLM_EXCLUDED.has(def.name)) {
          results.push({ id: call.id, name: call.name, content: JSON.stringify({ ok: false, error: 'Unknown or unavailable tool' }), isError: true });
          continue;
        }
        const out = await this.runTool(def.name, call.input, ctx, turnId, 'llm');
        const r = out.result ?? { ok: false, message: out.text };
        results.push({ id: call.id, name: call.name, content: JSON.stringify({ ok: r.ok, message: r.message, data: truncate(r.data) }), isError: !r.ok });
      }
      this.items.push({ role: 'tool', results });
      if (round === MAX_TOOL_ROUNDS - 1) finalText = finalText || 'I stopped after several steps to avoid looping. Here is where things stand in the activity panel.';
    }
    return { text: finalText || 'Done.', situation: 'explain', expectFollowUp: true, source: provider.kind === 'local' ? 'local_llm' : 'cloud_llm', providerLabel: provider.label };
  }

  private noModel(text: string): Outcome {
    const s = this.d.settings();
    const st = this.d.providers.status();
    const looksLikeCommand = /^(open|close|set|turn|start|play|switch|show|find|delete|move|create|make)\b/.test(text.toLowerCase());
    if (looksLikeCommand) return { text: "I'm not sure how to do that one. Try rephrasing, or say what can you do to hear what I support.", situation: 'info', expectFollowUp: true };
    if (s.ai.policy === 'strict_offline' || !st.cloud.hasKey || !st.cloud.allowed) {
      return {
        text: `I can't answer open questions right now because no ${s.ai.policy === 'strict_offline' ? 'local ' : ''}language model is available. ${st.local.message ?? ''} I can still handle commands like opening apps, volume, timers, and system status.`.replace(/\s+/g, ' ').trim(),
        situation: 'info',
      };
    }
    return { text: "My language model isn't reachable right now, so I can only handle built-in commands. Check your connection or the provider settings.", situation: 'failure' };
  }
}

function truncate(v: unknown): unknown {
  if (v === undefined) return undefined;
  const s = JSON.stringify(v);
  return s.length > 4000 ? `${s.slice(0, 4000)}…(truncated)` : v;
}
