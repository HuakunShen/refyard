/**
* | output |
* | --- |
* | "Reading the host's SSH configuration…" |
*
* @param {Exec_Reading_SshInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const exec_reading_ssh: ((inputs?: Exec_Reading_SshInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Exec_Reading_SshInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Exec_Reading_SshInputs = {};
