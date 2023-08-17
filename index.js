const util = require("util");
const plaid = require("plaid");
const path = require("path");
const fastify = require("fastify")({ logger: { level: "fatal" } });
const actual = require("@actual-app/api");
const opn = require("better-opn");
const dateFns = require("date-fns");
const inquirer = require("inquirer");
const terminalLink = require("terminal-link");
const Conf = require("conf");
const fs = require("fs");
require("dotenv").config();


const config = new Conf();

const ACTUAL_BUDGET_ID = process.env.ACTUAL_BUDGET_ID || "";

const APP_PORT = process.env.APP_PORT || 3000;

const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID || "";
const PLAID_SECRETS = {
    "development": process.env.PLAID_SECRET_DEVELOPMENT,
    "sandbox": process.env.PLAID_SECRET_SANDBOX,
};

const PLAID_ENV = process.env.PLAID_ENV || "sandbox";
const PLAID_PRODUCTS = (process.env.PLAID_PRODUCTS || "transactions").split(
    ","
);
const PLAID_COUNTRY_CODES = (process.env.PLAID_COUNTRY_CODES || "NL").split(",");

if (!PLAID_CLIENT_ID) {
    console.log(
        `Please provide a PLAID_CLIENT_ID env variable from the ${terminalLink(
            "Plaid Development Dashboard",
            "https://dashboard.plaid.com/overview/development"
        )}`
    );
}

if (!PLAID_SECRETS[PLAID_ENV]) {
    console.log(
        `Please provide a PLAID_SECRET env variable from the ${terminalLink(
            "Plaid Development Dashboard",
            "https://dashboard.plaid.com/overview/development"
        )}`
    );
}

var client = new plaid.Client({
    clientID: PLAID_CLIENT_ID,
    secret: PLAID_SECRETS[PLAID_ENV],
    env: plaid.environments[PLAID_ENV],
});


const prettyPrint = (item) => {
    console.log(util.inspect(item, { colors: true, depth: 4 }));
};

const transactionMapper = (accountId) => (transaction) => ({
    account: accountId,
    date: transaction.date,
    amount: -transaction.amount * 100,
    payee_name: transaction.merchant_name || transaction.name,
    imported_payee: transaction.merchant_name || transaction.name,
    notes: transaction.name,
    imported_id: transaction.transaction_id,
});

fastify.register(require("fastify-static"), {
    root: path.join(__dirname, "public"),
    prefix: "/public/",
});

const start = async () => {
    await fastify.listen(APP_PORT);
};

const printSyncedAccounts = () => {
    const data = config.get("actualSync");
    if (!data) {
        console.log("No syncing data found");
    }
    console.table(
        Object.values(data).map((account) => ({
            "Actual Account": account.actualName,
            "Actual Type": account.actualType,
            "Plaid Bank": account.plaidBankName,
            "Plaid Account": account.plaidAccount.name,
            "Plaid Type": `${account.plaidAccount.subtype}/${account.plaidAccount.type}`,
            "Plaid Account #": account.plaidAccount.mask,
        }))
    );
};

async function startLinkingPlaid() {
    const { dissmissedWarning } = await inquirer.prompt({
        type: "confirm",
        name: "dissmissedWarning",
        message: `WARNING: A Plaid Dev account has a limited number of Links. See the ${terminalLink(
            "Plaid Development Dashboard",
            "https://dashboard.plaid.com/overview/development"
        )} to check your usage. Proceed?`,
    });
    if (!dissmissedWarning) {
        throw new Error("Plaid Linking cancelled");
    }
    start();

    const { confirm } = await inquirer.prompt({
        type: "confirm",
        name: "confirm",
        message: `A browser window will now open. Please link each bank you expect to sync with Actual. Proceed?`,
    });

    if (!confirm) {
        throw new Error("Plaid Linking cancelled");
    }

    const plaidLinkLink = `http://localhost:${APP_PORT}`;
    console.log(
        `Opening ${plaidLinkLink} to link with Plaid...\nNOTE: Please return to your CLI when completed.`
    );
    opn(plaidLinkLink);

    let doneLinking = false;

    while (!doneLinking) {
        let result = await inquirer.prompt({
            type: "confirm",
            name: "doneLinking",
            message: `Are you done linking banks?`,
        });
        doneLinking = result.doneLinking;
    }

    const plaidAccounts = config.get("plaidAccounts");
    if (!plaidAccounts) {
        throw new Error("You did not Link any Plaid accounts");
    }
    return plaidAccounts
}


/**
 * 
 * @param {string} command 
 * @param {object} flags 
 * @param {string} flags.account
 * @param {string} flags.since
 */
module.exports = async (command, flags) => {
    if (!command) {
        console.log('Try "actualplaid --help"');
        process.exit();
    }
    try {
        if (!ACTUAL_BUDGET_ID) {
            throw new Error("No ACTUAL_BUDGET_ID env variable found")
        }
        fs.mkdirSync("./temp_data_actual", { recursive: true });
        await actual.init({
            serverURL: "http://10.1.0.61:5006",
            password: "MhkJBADk2UMVPE",
            dataDir: "./temp_data_actual/"
        });
        await actual.downloadBudget(ACTUAL_BUDGET_ID);
    } catch (e) {
        throw new Error(`Actual Budget Error: ${e.message}`);
    }
    if (command === "config") {
        console.log(config.path);
    } else if (command === "import") {
        const syncingData = config.get(`actualSync`) || {};

        if (Object.keys(syncingData).length) {
            const accountsToSync = Object.entries(syncingData).filter(
                ([_, account]) =>
                    !flags.account || account.actualName === flags.account
            );

            const endDate = dateFns.format(new Date(), "yyyy-MM-dd");

            const transactionsPerToken = {};

            const cachedTransaction = async (token, startDate) => {
                const key = `${token}-${startDate.toString()}`;
                if (!transactionsPerToken[key]) {
                    transactionsPerToken[key] = await client.getTransactions(
                        token,
                        startDate,
                        endDate,
                        {}
                    );

                }
                return transactionsPerToken[key];
            }

            for (let [actualId, account] of accountsToSync) {
                const startDate = dateFns.format(
                    new Date(
                        flags["since"] ||
                        account.lastImport ||
                        dateFns.startOfMonth(new Date())
                        // TODO: Last transaction in actual
                    ),
                    "yyyy-MM-dd"
                );
                const transactionsResponse = await cachedTransaction(account.plaidToken, startDate);
                const transactionsForThisAccount = transactionsResponse.transactions.filter(
                    (transaction) =>
                        transaction.account_id === account.plaidAccount.account_id
                );

                // TODO: Transactions can be pending
                const mapped = transactionsForThisAccount
                    .map(transactionMapper(actualId))

                const actualResult = await actual.importTransactions(
                    actualId,
                    mapped
                );
                console.log("Actual logs: ", actualResult)

                await actual.updateAccount(actualId, {
                    "note": `Synced with Plaid on ${new Date().toLocaleDateString()}\nAccount used: ${account.plaidBankName}: ${account.plaidAccount.name} - ${account.plaidAccount.subtype}/${account.plaidAccount.type} (${account.plaidAccount.mask})}`
                })

                config.set(`actualSync.${actualId}.lastImport`, new Date());
            }
            console.log("Import completed");
            actual.sync();

        } else {
            throw new Error("No syncing data found please run `actualplaid setup`");
        }

    } else if (command === "setup") {
        let plaidAccounts = config.get("plaidAccounts");
        if (!!plaidAccounts) {
            console.log("The following accounts are linked to plaid (and maybe actual):");
            console.table(
                Object.values(plaidAccounts).map(({ account, plaidBankName }) => ({
                    "Bank": plaidBankName,
                    "Account": account.name,
                    "Type": `${account.subtype}/${account.type}`,
                    "Account #": account.mask,
                }))
            );
            const { confirm } = await inquirer.prompt({
                type: "confirm",
                name: "confirm",
                message: `Do you want to re-link your accounts or add extra?`,
                default: false,

            });
            if (confirm) {
                plaidAccounts = await startLinkingPlaid()
            }
        }

        console.log("The following accounts will be used to link to actual:");
        console.table(
            Object.values(plaidAccounts).map(({ account, plaidBankName }) => ({
                "Bank": plaidBankName,
                "Account": account.name,
                "Type": `${account.subtype}/${account.type}`,
                "Account #": account.mask,
            }))
        );

        const actualAccounts = await actual.getAccounts();
        const { accountsToSync } = await inquirer.prompt({
            type: "checkbox",
            name: "accountsToSync",
            message: `Which accounts do you want to sync with plaid?`,
            choices: actualAccounts.map(({ name, id }) => ({ name, value: id })),
        });

        for (acctId of accountsToSync) {
            const actualAcct = actualAccounts.find((a) => a.id === acctId);
            // TODO: Maybe exclude accounts that are already linked
            let syncChoices = Object.values(plaidAccounts).map(
                ({ account, plaidBankName }) => ({
                    value: account.account_id,
                    name: `${plaidBankName}: ${account.name} - ${account.subtype}/${account.type} (${account.mask})`,
                })
            );
            const { plaidAccountToSync } = await inquirer.prompt({
                type: "list",
                name: "plaidAccountToSync",
                message: `Which Plaid acount do you want to sync with "${actualAcct.name}"?`,
                choices: syncChoices,
            });
            const plaidAccount = Object.values(plaidAccounts).find(
                ({ account }) => account.account_id === plaidAccountToSync
            );

            config.set(`actualSync.${acctId}`, {
                actualName: actualAcct.name,
                actualType: actualAcct.type,
                actualAccountId: actualAcct.id,
                plaidItemId: plaidAccount.plaidItemId,
                plaidToken: plaidAccount.plaidToken,
                plaidAccount: plaidAccount.account,
                plaidBankName: plaidAccount.plaidBankName,
            });
        }
        printSyncedAccounts();
        console.log(
            `Setup completed sucessfully. Run \`actualplaid import\` to sync your setup banks with their respective actual accounts`
        );

    } else if (command === "ls") {
        printSyncedAccounts();
    }
    process.exit();
};

fastify.get("/", (requst, reply) => reply.sendFile("index.html"));

fastify.post("/create_link_token", (request, reply) => {
    const configs = {
        user: { client_user_id: "user-id" },
        client_name: "Actual Budget Plaid Importer",
        products: PLAID_PRODUCTS,
        country_codes: PLAID_COUNTRY_CODES,
        language: "en",
    };
    client.createLinkToken(configs, (error, res) => {
        if (error != null) {
            prettyPrint(error);
            process.exit(1);
        }
        reply.send({ link_token: res.link_token });
    });
});

fastify.post("/get_access_token", async (request, reply) => {
    const body = JSON.parse(request.body);

    try {
        const { access_token, item_id } = await client.exchangePublicToken(body.public_token);
        const { accounts, item: { institution_id } } = await client.getAccounts(access_token);
        const { institution: { name } } = await client.getInstitutionById(institution_id);
        debugger;
        accounts.forEach((account) => {
            config.set(`plaidAccounts.${account.account_id}`, {
                account,
                plaidToken: access_token,
                plaidItemId: item_id,
                plaidBankName: name,
            });
        });
        reply.send({ ok: true });

    } catch (e) {
        console.error("ERR when linking tokens", e)
    }
});
