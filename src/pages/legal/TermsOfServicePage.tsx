import { Link } from "react-router"
export function TermsOfServicePage() {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background">
      <article className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">RuleLab</Link>
        <h1 className="text-3xl font-semibold">Project information</h1>
        <div className="space-y-5 text-base leading-7 text-muted-foreground">
          <p>RuleLab is an independent open-source tool for YARA-L rule authoring and local testing. It is not affiliated with or endorsed by Google.</p>
          <p>The source code is licensed under Apache License 2.0. See LICENSE and NOTICE in the source distribution for the license terms and third-party attribution.</p>
          <p>Local evaluation is an authoring aid and can differ from Google SecOps. Validate production behaviour in your Google SecOps environment.</p>
          <p>Instances are operated by their administrators. Contact the administrator of your instance for access and operational questions.</p>
        </div>
      </article>
    </main>
  )
}
