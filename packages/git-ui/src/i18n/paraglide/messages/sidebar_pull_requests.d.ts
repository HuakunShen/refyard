/**
* | output |
* | --- |
* | "Pull Requests" |
*
* @param {Sidebar_Pull_RequestsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_pull_requests: ((inputs?: Sidebar_Pull_RequestsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Sidebar_Pull_RequestsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Sidebar_Pull_RequestsInputs = {};
