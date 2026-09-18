import { mount } from "svelte";
import App from "./App.svelte";
import "./main.css";

declare const acquireVsCodeApi: () => {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

const vscode = acquireVsCodeApi();
const root = document.getElementById("app");
if (root === null) {
  throw new Error("the panel has no #app mount point");
}

// One pending request at a time is all the panel needs: reads are user-paced.
let pendingId = 0;
const pending = new Map<
  number,
  { resolve: (answer: unknown) => void; reject: (problem: unknown) => void }
>();

window.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as
    | { id: number; ok: true; answer: unknown }
    | { id: number; ok: false; problem: unknown };
  const waiting = pending.get(message.id);
  if (waiting === undefined) {
    return;
  }
  pending.delete(message.id);
  if (message.ok) {
    waiting.resolve(message.answer);
  } else {
    waiting.reject(message.problem);
  }
});

export async function call(payload: unknown): Promise<unknown> {
  pendingId += 1;
  const id = pendingId;
  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  vscode.postMessage({ id, payload });
  return promise;
}

mount(App, {
  target: root,
  props: {
    call,
  },
});
