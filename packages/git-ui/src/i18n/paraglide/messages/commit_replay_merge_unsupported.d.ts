/**
* | output |
* | --- |
* | "This operation does not support merge commits." |
*
* @param {Commit_Replay_Merge_UnsupportedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_replay_merge_unsupported: ((inputs?: Commit_Replay_Merge_UnsupportedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_Replay_Merge_UnsupportedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_Replay_Merge_UnsupportedInputs = {};
