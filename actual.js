const { getAppConfigFromEnv } = require("./config");
const actual = require("@actual-app/api");
const fs = require("fs");
const inquirer = require("inquirer");
let { q, runQuery } = require('@actual-app/api');


const appConfig = getAppConfigFromEnv();

/**
 * 
 * @returns {Promise<typeof actual>}
 */
async function initialize(config) {
    try {
        const tmp_dir = `./temp_data_actual/${config.get("user")}`
        fs.mkdirSync(tmp_dir, { recursive: true });
        await actual.init({
            serverURL: appConfig.ACTUAL_SERVER_URL,
            password: appConfig.ACTUAL_SERVER_PASSWORD,
            dataDir: tmp_dir
        });

        let id = config.get("budget_id")
        if (!id) {
            id = (await inquirer.prompt({
                name: "budget_id",
                message: `This is your (${config.get('user')}) first time using this user, what is your budget sync Id? (Can be found in advanced settings on Actual as the 'Sync Id')`,
            })).budget_id
            config.set("budget_id", id)
        }

        if (appConfig.ACTUAL_SERVER_ENCRYPTION_PASSWORD) {
            await actual.downloadBudget(id, { password: appConfig.ACTUAL_SERVER_ENCRYPTION_PASSWORD });
        }
        else {
            await actual.downloadBudget(id);
        }
    } catch (e) {
        throw new Error(`Actual Budget Error: ${e.message}`);
    }

    return actual;
}

/**
 * 
 * @param {typeof actual} actualInstance 
 */
function listAccounts(actualInstance) {
    return actualInstance.getAccounts();
}

/**
 * Only works for the past month
 * @param {typeof actual} actualInstance 
 * @param {*} accountId 
 */
async function getLastTransactionDate(actualInstance, accountId) {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const transactions = await actualInstance.getTransactions(accountId, monthAgo, new Date());

    if (transactions.length === 0) {
        return new Date(0);
    }

    // Transactions of the day are already imported, so start from the next day.
    const last = new Date(transactions[0].date);
    last.setDate(last.getDate() + 1);

    return last;
}

const ABN_AMRO_TRANSACTION_MAPPER = (accountId) => (transaction) => {
    const description = transaction.name
    let notes = description;
    let payee = description;

    if (description.includes("TRTP")) {
        let splitted = description.split("/");
        if (splitted[2].includes("iDEAL") || splitted[2].includes("SEPA OVERBOEKING")) {
            payee = splitted[8].trim();
            notes = splitted[10].trim();
        } else if (splitted[2].includes("SEPA Incasso")) {
            payee = splitted[6].trim();
            notes = splitted[10].trim();
        }
    } else if (description.includes("SEPA iDEAL")) {
        let splitted = description.split("Naam:");
        payee = splitted[1].split("Omschrijving:")[0].trim();
        notes = splitted[1].split("Omschrijving:")[1].split("Kenmerk:")[0].trim();
    } else if (description.includes("BEA")) {
        let splitted = description.split(",");
        let info = splitted[1].replace(" Apple Pay", "").replace("Betaalpas", "").replace("PAS544", "").trim();
        payee = info;
    } else if (description.includes("SEPA Incasso")) {
        let splitted = description.split("Naam:");
        if (splitted[1].includes("Machtiging:")) {
            payee = splitted[1].split("Machtiging:")[0].trim();
        } else {
            payee = splitted[1].split("Omschrijving:")[0].trim();
        }
        notes = splitted[1].split("Omschrijving:")[1].split("IBAN:")[0].trim();
    } else if (description.includes("SEPA Overboeking")) {
        let splitted = description.split("Naam:");
        if (splitted.length > 1) {
            if (splitted[1].includes("Omschrijving:")) {
                payee = splitted[1].split("Omschrijving:")[0].trim();
                if (splitted[1].includes("Kenmerk:")) {
                    notes = splitted[1].split("Omschrijving:")[1].split("Kenmerk:")[0].trim();
                } else {
                    notes = splitted[1].split("Omschrijving:")[1].trim();
                }
            } else {
                payee = splitted[1].trim();
                notes = "";
            }
        } else {
            payee = splitted[0];
            notes = "";
        }
    }


    let convertedAmount = transaction.amount * 100;

    convertedAmount = Math.round(convertedAmount);
    convertedAmount *= -1;

    return {
        account: accountId,
        date: transaction.date,
        amount: convertedAmount,
        payee_name: payee,
        imported_payee: payee,
        notes: notes,
        imported_id: transaction.transaction_id,
    }

}


const GENERIC_TRANSACTION_MAPPER = (accountId) => (transaction) => {
    //if (transaction.pending) {
    //    console.error(transaction, accountId)
    //    throw new Error("Pending transactions are not supported")
    //}

    let convertedAmount = transaction.amount * 100;

    convertedAmount = Math.round(convertedAmount);
    convertedAmount *= -1;

    return {
        account: accountId,
        date: transaction.date,
        amount: convertedAmount,
        payee_name: transaction.merchant_name || transaction.name,
        imported_payee: transaction.merchant_name || transaction.name,
        //notes: transaction.name,
        imported_id: transaction.transaction_id,
        cleared: !transaction.pending,
    }
}
const map = {
    "ABN AMRO": ABN_AMRO_TRANSACTION_MAPPER,
}

const transactionMapper = (accountId, bank) => {
    if (map[bank]) {
        return map[bank](accountId)
    } else {
        return GENERIC_TRANSACTION_MAPPER(accountId)
    }
}


async function importPlaidTransactions(actualInstance, accountId, bank, transactions) {
    const mapped = transactions
        .map(transactionMapper(accountId, bank))

    const actualResult = await actualInstance.importTransactions(
        accountId,
        mapped
    );
    console.log("Imported transactions raw data START:")
    console.log(transactions)
    console.log("ENV")
    console.log("Actual logs: ", actualResult);
}

async function getBalance(actualInstance, accountId) {
    const balance = await actualInstance.runQuery(q('transactions')
        .filter({ account: accountId })
        //.options({ splits: 'inline' })
        .calculate({ $sum: '$amount' }),)
    return balance.data;
}

/**
 * 
 * @param {typeof actual} actualInstance 
 */
async function finalize(actualInstance) {
    await actualInstance.sync()
    await actualInstance.shutdown();
}

module.exports = {
    initialize,
    listAccounts,
    getLastTransactionDate,
    importPlaidTransactions,
    transactionMapper,
    finalize,
    getBalance
}
