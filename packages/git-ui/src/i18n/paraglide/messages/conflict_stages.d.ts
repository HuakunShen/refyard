/**
* | output |
* | --- |
* | "stages {stages}" |
*
* @param {Conflict_StagesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_stages: ((inputs: Conflict_StagesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_StagesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_StagesInputs = {
    stages: NonNullable<unknown>;
};
