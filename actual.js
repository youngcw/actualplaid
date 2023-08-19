const getAppConfigFromEnv = require("./config");
const actual = require("@actual-app/api");
const fs = require("fs");

const appConfig = getAppConfigFromEnv();

/**
 * 
 * @returns {Promise<typeof actual>}
 */
async function initialize() {
    try {
        fs.mkdirSync("./temp_data_actual", { recursive: true });
        await actual.init({
            serverURL: appConfig.ACTUAL_SERVER_URL,
            password: appConfig.ACTUAL_SERVER_PASSWORD,
            dataDir: "./temp_data_actual/"
        });
        await actual.downloadBudget(appConfig.ACTUAL_BUDGET_ID);
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
function getLastTransactionDate(actualInstance, accountId) {
    const account = actualInstance.getAccount(accountId);

    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);


    const transactions = actualInstance.getTransactions(accountId, monthAgo, new Date(),);
    const last = transactions[account.transactions.length - 1];

    return last.date;
}


const transactionMapper = (accountId) => (transaction) => ({
    account: accountId,
    date: transaction.date,
    amount: -transaction.amount * 100,
    payee_name: transaction.merchant_name || transaction.name,
    imported_payee: transaction.merchant_name || transaction.name,
    notes: transaction.name,
    imported_id: transaction.transaction_id,
});


async function importPlaidTransactions(actualInstance, accountId, transactions) {
    const mapped = transactions
        .map(transactionMapper(accountId))

    const actualResult = await actualInstance.importTransactions(
        accountId,
        mapped
    );
    console.log("Actual logs: ", actualResult);
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
    finalize
}