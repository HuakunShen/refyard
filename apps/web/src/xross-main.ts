/** The isolated native Xross entry: no browser session or Tauri adapter imports. */
import "./app.css";
import { mount } from "svelte";
import XrossPage from "./routes/xross/+page.svelte";

const target = document.getElementById("app");
if (target === null) throw new Error("Xross app mount is missing");
mount(XrossPage, { target });
