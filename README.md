# actualplaid

# Deprecation of Development
As of June 20 2024, Plaid has dropped its development api.  There is now only sandbox and production.  Production has a capped number of calls that are free.  Therefore Plaid no longer has a way to use its api for free.

## Setup

-   Clone this repo!
-   Install dependencies: `npm ci`
-   Create [plaid developer account](https://dashboard.plaid.com/overview/development) and collect client id/secret keys
-   Copy `.env.sample` to `.env` and fill in the blanks
-   Open Actual Budget desktop app
-   Run `setup`: `node index.js setup`
-   Login to banks you would like to sync
-   Switch back to CLI and map to accounts in Actual Budget
-   Run `import`: `node index.js import`, this will import all transactions (from the past 2 years) to Actual

## Some things worth noting

The intial transaction import does not have a starting balance, so you will need to manually add that to Actual Budget.

You need to manually create the accounts inside Actual, and then map them to the accounts you setup in Plaid.

Pending transactions give an error, so you will need to wait until they are posted to import them.

Some banks require production access, and also oAuth support to be enabled. You can see this on the institution detail page, within Plaid.

## oAuth + Production Access Steps

- In your Plaid developer account, search for "oAuth". For example, [US oAuth Approval steps can be found here](https://dashboard.plaid.com/settings/compliance/us-oauth-institutions).


- Fill out your [Company Profile](https://dashboard.plaid.com/settings/company/profile) (I used my name, as a sole proprietor, and my address).

- Fill out your required [application display information / App Branding](https://dashboard.plaid.com/settings/company/app-branding). For example, you'll need a logo, name of app, etc. Not all fields are required (will prompt you if they are).

- Addendum to Plaid MSA is automatically completed when you are approved for production access.

- Fill out the security questionairre (required for some banks). Doing this before requestion production access is strongly encouraged. I suggest answering truthfully, of course, but choosing secure options that don't require creating and uploading documentation, unless that's something you enjoy. I used the comment field liberally, stating that I am the only employee / contractor that will have access to the data, since it's only for personal use.  (see technical notes below). This was auto-approved, with a confirmation email almost immediately, since I was "secure enough".

- Apply for production access. Typically takes 1-2 business days, and you will need to link a payment method. Make sure you include transactions, at the minimum, for services you want access to. I strongly recommend "Pay as You Go". Production "pay as you go" (at the time of writing) costs $0.30 / mo / account for transactions access, and $1.50 / account for initial authentication. You are given $500 credit / mo, free, for the first 6 months.

- Once approved, you will have immediate access to some banks requiring oAuth (US Bank, etc), but others might have a delay until they are approved by the institutions in question (Chase has a roughly 2 week wait, etc).

## oAuth Important Considerations

- oAuth requies serving the tool over HTTPS. 

- For the security audit questionnaire purposes, I put the URL I serve it from behind 2FA (Authelia). May be able to get by without.

- Set the .env APP_URL value to your https address. https://example.com, for example.

- When linking oAuth accounts, do the linking on a desktop / laptop is recommended (don't need a redirect URI in the code)

- I used a reverse proxy to proxy http://127.0.0.1:3000 (or whatever port you pick) to my https url in APP_URL, and would suggest the same.

- I'm not sure if you need to add the Allowed Redirect URI or not, if you're using a Desktop / Laptop. That can be set here: https://dashboard.plaid.com/developers/api , if you want to be safe (use the same APP_URL value)

- Even though some banks say they support oAuth in Development, I had a couple that said that, but only worked when I switched to Production.

- If you want to keep costs down, I don't see any issues with running 2 instances of this, one set for Production (for oAuth), and one set for Development

## Commands


```
  Usage
    $ actualplaid <command> <flags>

  Commands & Options
    setup            Link bank accounts with your Actual Budget accounts via Plai
    ls               List currently syncing accounts
    import           Sync bank accounts to Actual Budget
      --account, -a   The account to import, ex: --account="My Checking"
      --since, -s     The start date after which transactions should be imported. Defaults to beginning of current month, format: yyyy-MM-dd, ex: --since=2020-05-28
    config           Print the location of actualplaid the config file
    check            Compare the Actual Budget balance to the synced accounts
    --version        Print the version of actualplaid being used

  Options for all commands
    --user, -u       Specify the user to load configs for
  Examples
    $ actualplaid import --account="My Checking" --since="2020-05-28"
```
