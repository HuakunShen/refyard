/**
* | output |
* | --- |
* | "include untracked files" |
*
* @param {Stash_Aria_UntrackedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const stash_aria_untracked: ((inputs?: Stash_Aria_UntrackedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Stash_Aria_UntrackedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Stash_Aria_UntrackedInputs = {};
