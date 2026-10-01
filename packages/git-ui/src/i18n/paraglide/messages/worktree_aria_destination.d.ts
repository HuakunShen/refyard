/**
* | output |
* | --- |
* | "worktree destination" |
*
* @param {Worktree_Aria_DestinationInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_aria_destination: ((inputs?: Worktree_Aria_DestinationInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_Aria_DestinationInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_Aria_DestinationInputs = {};
