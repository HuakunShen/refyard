/**
* | output |
* | --- |
* | "Patches are read one path at a time" |
*
* @param {Diff_Patches_One_PathInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const diff_patches_one_path: ((inputs?: Diff_Patches_One_PathInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Diff_Patches_One_PathInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Diff_Patches_One_PathInputs = {};
