/**
* | output |
* | --- |
* | "Exited ({code})" |
*
* @param {Terminal_ExitedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const terminal_exited: ((inputs: Terminal_ExitedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Terminal_ExitedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Terminal_ExitedInputs = {
    code: NonNullable<unknown>;
};
