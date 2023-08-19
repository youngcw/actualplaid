#!/usr/bin/env node
const meow = require("meow");
const actualPlaid = require("./cli.js");
const cli = meow(
    `
  Usage
    $ actualplaid <command> <flags>

  Commands & Options
    setup            Link bank accounts with your Actual Budget accounts via Plai
    ls               List currently syncing accounts
    import           Sync bank accounts to Actual Budget
      --account, -a   The account to import, ex: --account="My Checking"
      --since, -s     The start date after which transactions should be imported. Defaults to beginning of current month, format: yyyy-MM-dd, ex: --since=2020-05-28
    config           Print the location of actualplaid the config file
    --version        Print the version of actualplaid being used

  Examples
    $ actualplaid import --account="My Checking" --since="2020-05-28"
`,
    {
        flags: {
            reset: {
                alias: "r",
                type: "string",
            },
            account: {
                alias: "a",
                type: "string",
            },
            since: {
                alias: "s",
                type: "string",
            },
        },
    }
);

actualPlaid(cli.input[0], cli.flags);
