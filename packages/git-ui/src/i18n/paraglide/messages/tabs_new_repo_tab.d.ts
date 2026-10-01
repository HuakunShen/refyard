/**
* | output |
* | --- |
* | "New repository tab" |
*
* @param {Tabs_New_Repo_TabInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const tabs_new_repo_tab: ((inputs?: Tabs_New_Repo_TabInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Tabs_New_Repo_TabInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Tabs_New_Repo_TabInputs = {};
