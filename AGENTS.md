<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Agent loop lives in src/lib/agent-core.server.ts with injected model/search so the 3-step guard is unit-testable (src/test/agent-guard.test.ts); agent.functions.ts only wires the real gateway model; IRS retrieval stays server-side in src/lib/irs-sources.server.ts.
- Capital gains arithmetic lives in a pure validated integer-cent utility; only the approved SDK tool executor invokes it, so model text cannot substitute for an actual calculation.
- Approval continuation uses SDK toolApproval and encrypted, expiring stateless transcripts with a cumulative model-step budget; browser edits cannot reset the production guard or forge tool results. Continuations are not saved across reloads; deterministic duplicate requests may repeat the same approved calculation, never a financial transaction.
