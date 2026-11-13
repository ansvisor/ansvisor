# Core-loop funnel (PostHog)

The share of new workspaces that complete the product's core loop within 7 days:

**signed up → first prompt tracked → first tracking results → first Action Center action → first task done**

## The five events

| Step | Event                    | Fires                                                                                                                                                                                                                               | Properties                                                                                        |
| ---- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1    | `signed_up`              | Web server, when the account is first confirmed: `auth/confirm` (e-mail sign-up link) and `auth/callback` (a first Google or GitHub sign-in).                                                                                       | `source` (`email` or `oauth`), `provider` (oauth)                                                 |
| 2    | `prompt_tracked`         | Web server action, when prompts are saved: `savePromptSet` (onboarding, add-brand wizard) and `addPromptToSet` (one prompt: the Prompts page, Prompt Suggestions' +, and each prompt of Add All, which sends one event per prompt). | `brand_id`, `count`, `source` (`prompt_set` or `single`)                                          |
| 3    | `tracking_results_ready` | API server, when a full tracking run stamps with results (`lib/job-runner.js`).                                                                                                                                                     | `brand_id`, `organization_id`, `plan`, `result_count`, `first_run`, `source` (`manual` or `cron`) |
| 4    | `action_created`         | API server, when an Action Center action is created from signals (`generate.js`) or sent from Chat (`from-chat.js`).                                                                                                                | `brand_id`, `organization_id`, `plan`, `source` (`signals` or `chat`), `kind`, `task_count`       |
| 5    | `task_completed`         | Web server, when a task is marked done, status `completed` (`writeTaskStatus`: the drawer's tick and Chat's "Attach to task & mark done").                                                                                          | `brand_id`, `action_id`, `source`                                                                 |

Events are sent on every occurrence. A PostHog funnel counts the first one per person, so nothing needs a "first" flag.
Properties are ids, counts, the plan and sources only: no e-mail, name, prompt text or customer URL.

Known gaps: actions created by other generators (audits, content drafts, mentions, products, Business Hub) do not send `action_created` yet, and a task finished by the server (an automatic check) does not send `task_completed`.

## Identity

The person is the **user id**, the id the browser identifies with (`identify(session.user.id)`), so the web and server events join into one person. There are no PostHog groups, so the funnel runs **per person**.

Workspace-level server events (steps 3 and 4) are sent as the acting user when there is one (an action sent from Chat), otherwise as the workspace's first admin, the person who signed up with it. To read the share of **workspaces**, filter the funnel to the people who signed up (step 1 is always the workspace's first admin); the person property `organization_id` is also set on every person.

Nothing is sent unless the key is set: the web's `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`, and the API server's `POSTHOG_KEY` and `POSTHOG_HOST` (the same project). Self-hosted installs send nothing.

## Build the funnel in PostHog

1. Open **Product analytics → New insight → Funnels**.
2. Add the steps in this order, each as the event (not an action), "Any" filter: `signed_up`, `prompt_tracked`, `tracking_results_ready`, `action_created`, `task_completed`.
3. Under **Advanced options**: _Conversion window limit_ = **7 days**; _Step order_ = **Sequential**; _Aggregating by_ = **Unique users**.
4. Set the date range to the sign-up period you want to measure (cohorts that signed up at least 7 days ago are complete).
5. **Breakdown**: add a breakdown by the person property `plan`, or by `$initial_utm_source` (set from the first page view, for example `utm_source=pulse` on Pulse links). A person property breakdown uses its value at the first step.
6. Read the overall conversion rate (step 1 to step 5), and click a step's drop-off to see the people who stopped there.
7. Save the insight, and add it to a dashboard.
