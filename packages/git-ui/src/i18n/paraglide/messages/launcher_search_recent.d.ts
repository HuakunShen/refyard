/**
* | output |
* | --- |
* | "Search recent repositories" |
*
* @param {Launcher_Search_RecentInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_search_recent: ((inputs?: Launcher_Search_RecentInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Launcher_Search_RecentInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Launcher_Search_RecentInputs = {};
