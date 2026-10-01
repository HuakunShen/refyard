/**
* | output |
* | --- |
* | "Where should Git run?" |
*
* @param {Exec_Where_Git_RunsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const exec_where_git_runs: ((inputs?: Exec_Where_Git_RunsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Exec_Where_Git_RunsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Exec_Where_Git_RunsInputs = {};
