/**
* | output |
* | --- |
* | "No repositories" |
*
* @param {Sidebar_No_ReposInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_no_repos: ((inputs?: Sidebar_No_ReposInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Sidebar_No_ReposInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Sidebar_No_ReposInputs = {};
