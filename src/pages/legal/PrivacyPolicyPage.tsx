import { Link } from "react-router"
export function PrivacyPolicyPage() {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background">
      <article className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">RuleLab</Link>
        <h1 className="text-3xl font-semibold">Data and privacy</h1>
        <div className="space-y-5 text-base leading-7 text-muted-foreground">
          <p>RuleLab can be self-hosted. The administrator of each instance controls its database, email provider, configuration, logs, and backups.</p>
          <p>Account email addresses, authentication records, saved rules, test cases, data tables, API-key hashes are stored by the instance. Drafts and interface preferences may also be stored in your browser.</p>
          <p>Rule authoring and local evaluation do not automatically submit rules or test events to Google SecOps. Saving data sends it to your RuleLab instance. Password-reset emails use the configured email provider.</p>
          <p>API requests may include source text and event data. Use synthetic events where possible and only enter data your instance is authorised to process.</p>
          <p>You can delete saved resources and your account from the app. Backup and log retention depend on the instance administrator. Contact that administrator for their privacy policy and retention details.</p>
        </div>
      </article>
    </main>
  )
}
