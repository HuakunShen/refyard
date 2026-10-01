/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conflict_Operation_MailboxInputs */

const en_conflict_operation_mailbox = /** @type {(inputs: Conflict_Operation_MailboxInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`mailbox apply`)
};

const zh_conflict_operation_mailbox = /** @type {(inputs: Conflict_Operation_MailboxInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`应用邮件补丁`)
};

/**
* | output |
* | --- |
* | "mailbox apply" |
*
* @param {Conflict_Operation_MailboxInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_operation_mailbox = /** @type {((inputs?: Conflict_Operation_MailboxInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_Operation_MailboxInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_operation_mailbox(inputs)
	return en_conflict_operation_mailbox(inputs)
});