# actualplaid

## Setup

-   Clone this repo!
-   Install dependencies: `npm ci`
-   Create [plaid developer account](https://dashboard.plaid.com/overview/development) and collect client id/secret keys
-   Copy `.sample.env` to `.env` and fill in the blanks
-   Open Actual Budget desktop app
-   Run `setup`: `node index.js setup`
-   Login to banks you would like to sync
-   Switch back to CLI and map to accounts in Actual Budget
-   Run `import`: `node index.js import`

## Commands

```
  Usage
    $ node index.js <command> <flags>

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
```
