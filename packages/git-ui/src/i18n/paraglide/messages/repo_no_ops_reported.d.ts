/**
* | output |
* | --- |
* | "the service has not reported its operations" |
*
* @param {Repo_No_Ops_ReportedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_no_ops_reported: ((inputs?: Repo_No_Ops_ReportedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Repo_No_Ops_ReportedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Repo_No_Ops_ReportedInputs = {};
