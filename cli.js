const util = require("util");
const plaid = require("plaid");
const path = require("path");
const Fastify = require("fastify");
const fastifyStatic = require("fastify-static");
const opn = require("better-opn");
const dateFns = require("date-fns");
const inquirer = require("inquirer");
const terminalLink = require("terminal-link");
const { getAppConfigFromEnv, getConf } = require("./config.js");
const { initialize, getLastTransactionDate, importPlaidTransactions, listAccounts, finalize } = require("./actual.js");

const fastify = Fastify({ logger: true });
let config;
const appConfig = getAppConfigFromEnv()
const plaidClient = new plaid.Client({
    clientID: appConfig.PLAID_CLIENT_ID,
    secret: appConfig.PLAID_SECRETS[appConfig.PLAID_ENV],
    env: plaid.environments[appConfig.PLAID_ENV],
});

fastify.register(fastifyStatic, {
    root: path.join(__dirname, "public"),
    prefix: "/public/",
});

const startFastifyServer = async () => {
    await fastify.listen(appConfig.APP_PORT);
};

const printSyncedAccounts = () => {
    const actualData = config.get("actualSync");
    const plaidData = config.get("plaidAccounts");
    if (!actualData) {
        console.log("No syncing data found");
        return;
    }

    console.log("The following accounts are linked to Actual:");
    console.table(
        Object.values(actualData).map((account) => ({
            "Actual Account": account.actualName,
            "Actual Type": account.actualType,
            "Plaid Bank": account.plaidBankName,
            "Plaid Account": account.plaidAccount.name,
            "Plaid Type": `${account.plaidAccount.subtype}/${account.plaidAccount.type}`,
            "Plaid Account #": account.plaidAccount.mask,
        }))
    );

    const linkedToActual = Object.entries(actualData).map(
        ([actualId, { plaidAccount }]) => { return { plaid: plaidAccount.account_id, actual: actualId } }
    )

    linkedToActual.forEach((ids) => {
        delete plaidData[ids.plaid];
    });

    console.log("The following Plaid accounts are linked to this app, but not to Actual:");
    console.table(
        Object.values(plaidData).map(({ account, plaidBankName }) => ({
            "Bank": plaidBankName,
            "Account": account.name,
            "Type": `${account.subtype}/${account.type}`,
            "Account #": account.mask,
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
    startFastifyServer();

    const { confirm } = await inquirer.prompt({
        type: "confirm",
        name: "confirm",
        message: `A browser window will now open. Please link each bank you expect to sync with Actual. Proceed?`,
    });

    if (!confirm) {
        throw new Error("Plaid Linking cancelled");
    }

    const plaidLinkLink = `http://localhost:${appConfig.APP_PORT}`;
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
        throw new Error("You did not link any Plaid accounts");
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

    config = getConf(flags.user || "default")

    if (command === "config") {
        console.log(`Config for this app is located at: ${config.path}`);
    } else if (command === "import") {
        const syncingData = config.get(`actualSync`) || {};

        if (Object.keys(syncingData).length) {
            const actual = await initialize();
            const accountsToSync = Object.entries(syncingData).filter(
                ([_, account]) =>
                    !flags.account || account.actualName === flags.account
            );

            const endDate = dateFns.format(new Date(), "yyyy-MM-dd");

            const transactionsPerToken = {};

            const cachedTransaction = async (token, startDate) => {
                const key = `${token}-${startDate.toString()}`;
                if (!transactionsPerToken[key]) {
                    transactionsPerToken[key] = await plaidClient.getTransactions(
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
                        getLastTransactionDate(actual, actualId)
                    ),
                    "yyyy-MM-dd"
                );

                console.log("Importing transactions for account: ", account.plaidAccount.name, "from ", startDate, "to", endDate)
                const tempStartTime = new Date();

                const transactionsResponse = await cachedTransaction(account.plaidToken, startDate);
                const transactionsForThisAccount = transactionsResponse.transactions.filter(
                    (transaction) =>
                        transaction.account_id === account.plaidAccount.account_id
                );

                // Sleep at least 1 sec to let user cancel, continue with promise
                const timeTookForPlaid = new Date() - tempStartTime;
                const timeToSleep = 2000 - timeTookForPlaid;
                if (timeToSleep > 0) {
                    await new Promise((resolve) => setTimeout(resolve, timeToSleep));
                }

                // TODO: Transactions can be pending
                importPlaidTransactions(actual, actualId, transactionsForThisAccount);
                config.set(`actualSync.${actualId}.lastImport`, new Date());
            }
            console.log("Import completed for all accounts");

            finalize(actual)
        } else {
            throw new Error("No syncing data found please run `actualplaid setup`");
        }

    } else if (command === "setup") {
        let plaidAccounts = config.get("plaidAccounts");
        const linkedToActual = Object.entries(config.get("actualSync") || {}).map(
            ([actualId, { plaidAccount }]) => { return { plaid: plaidAccount.account_id, actual: actualId } }
        )

        linkedToActual.forEach((ids) => {
            delete plaidAccounts[ids.plaid];
        });


        if (Object.keys(plaidAccounts).length == 0) {
            console.log("There are no accounts linked to Plaid that are not already in Actual. Please link at least one new account to continue.")
            plaidAccounts = await startLinkingPlaid();
        } else {
            console.log("The following accounts are linked to Plaid, but not to Actual:");
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
                plaidAccounts = await startLinkingPlaid();
            }
        }

        // Remove accounts that are now linked again.
        linkedToActual.forEach((ids) => {
            delete plaidAccounts[ids.plaid];
        });

        console.log("The following accounts will be used to link to actual:");
        console.table(
            Object.values(plaidAccounts).map(({ account, plaidBankName }) => ({
                "Bank": plaidBankName,
                "Account": account.name,
                "Type": `${account.subtype}/${account.type}`,
                "Account #": account.mask,
            }))
        );

        const actualAccounts = await listAccounts(await initialize());
        const { accountsToSync } = await inquirer.prompt({
            type: "checkbox",
            name: "accountsToSync",
            message: `Which accounts do you want to sync with plaid?`,
            choices: actualAccounts.map(({ name, id }) => ({ name, value: id })).filter(({ value }) => !linkedToActual.find(({ actual }) => actual === value)),
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

fastify.get("/", (req, reply) => reply.sendFile("index.html"));

fastify.post("/create_link_token", (request, reply) => {
    const configs = {
        user: { client_user_id: "user-id" },
        client_name: "Actual Budget Plaid Importer",
        products: PLAID_PRODUCTS,
        country_codes: PLAID_COUNTRY_CODES,
        language: "en",
    };
    plaidClient.createLinkToken(configs, (error, res) => {
        if (error != null) {
            console.error(error);
            process.exit(1);
        }
        reply.send({ link_token: res.link_token });
    });
});

fastify.post("/get_access_token", async (request, reply) => {
    const body = JSON.parse(request.body);

    try {
        const { access_token, item_id } = await plaidClient.exchangePublicToken(body.public_token);
        const { accounts, item: { institution_id } } = await plaidClient.getAccounts(access_token);
        const { institution: { name } } = await plaidClient.getInstitutionById(institution_id);
        accounts.forEach((account) => {

            // TODO: Duplicate prevention
            config.set(`plaidAccounts.${account.account_id}`, {
                account,
                plaidToken: access_token,
                plaidItemId: item_id,
                plaidBankName: name,
                plaidInstitutionId: institution_id,
            });
        });
        reply.send({ ok: true });

    } catch (e) {
        console.error("ERR when linking tokens", e)
    }
});
