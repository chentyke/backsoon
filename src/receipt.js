import { setTimeout as sleep } from 'node:timers/promises';
import { openAppServer, Rejected } from './rpc.js';

// Codex desktop starts queued input for a chat it has open, and BackSoon
// cannot reach its app server to ask. A resume request would instead hand the
// chat to a separate daemon, or only print a warning when there is none.
export function usesDesktopQueue(task) {
  return Boolean(process.env.CODEX_APP_TOOLS_PIPE_PATH && !task.remote &&
    ['steer', 'resume'].includes(task.notify) &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(task.notify_thread));
}

async function findNoticeTurn(api, threadId, marker, deadline) {
  try {
    const { data } = await api.call('thread/turns/list', {
      threadId, limit: 8, sortDirection: 'desc', itemsView: 'summary',
    }, deadline);
    return data.find(turn => turn.items?.some(item => item.type === 'userMessage' &&
      item.content?.some(part => part.type === 'text' && part.text.startsWith(marker))))?.id;
  } catch (error) {
    // A newly saved chat can be readable before its turns are available.
    if (error instanceof Rejected && /not loaded|not found|no rollout|list_turns is not supported yet/i.test(error.message))
      return null;
    throw error;
  }
}

// An accepted queue entry or a resume request does not show that the chat took
// the completion. Look for the turn that carries it in the original chat. This
// only reads the chat's history, so it never claims the chat from its owner.
export async function noticeTurn(command, task, wait = Number(process.env.BACKSOON_PICKUP_WAIT ?? 60)) {
  const reader = openAppServer(command);
  const deadline = Date.now() + wait * 1000;
  const marker = '[BackSoon ' + task.id + ' done] ';
  try {
    await reader.api.initialize(Date.now() + 10000);
    while (true) {
      const turnId = await findNoticeTurn(reader.api, task.notify_thread, marker, Date.now() + 5000);
      if (turnId) return turnId;
      if (Date.now() >= deadline) return null;
      await sleep(Math.min(1000, deadline - Date.now()));
    }
  } catch {
    return null;
  } finally {
    reader.close();
  }
}
