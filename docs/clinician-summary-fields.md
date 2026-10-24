# Clinician summary fields

The clinician summary follows the structure of the CMS [ACCESS Model Care Update Template](https://www.cms.gov/priorities/innovation/files/access-care-update-template.pdf), so a clinician sees a familiar layout. iamyou is not an ACCESS participant and does not diagnose or treat, so fields that describe treatment or billing are adapted as shown below.

| # | CMS template field | iamyou summary field | Content | Source |
| --- | --- | --- | --- | --- |
| 1 | Subject: ACCESS Care Update, [Care Initiation / Update / Care Completion / Care Escalation], [Patient initial and last name] | **Subject:** iamyou Care Summary, [Update / Change noticed], [initial and last name] | "Change noticed" only when a gated change signal exists; otherwise "Update" | profile, signal |
| 2 | Intro paragraph (ACCESS model, co-management billing) | **Intro** | Fixed text: "This summary was prepared by iamyou at the person's request, from their own conversations and wearable data. It is not a diagnosis and no clinician has reviewed it." | fixed |
| 3 | Patient: [Name], DOB | **Person:** name, date of birth | | profile |
| 4 | From: [Organization], [Website], [Responsible clinician], [Monitored contact] | **From:** iamyou, iamyou.si, contact chosen by the person | No clinician field: none is involved | profile |
| 5 | Tracks | **Focus:** "Personal baseline: language, sleep and activity" | | fixed |
| 6 | Qualifying Conditions: [Conditions and diagnosis codes] | **Family history:** condition and relation, e.g. "Familial Alzheimer's disease (father)" | No diagnosis codes for the person. Whether to add a family-history code is for the team's medical member to decide | profile |
| 7 | Care Start, Update Date | **Baseline start** (first week of data), **Summary date** | | weekly features |
| 8 | Clinical Measures: Measure, Baseline value, Most recent value, Target value | **Measures:** one row per feature: baseline mean, most recent 4-week mean, change against own baseline (z) | Features: vocabulary diversity, mean sentence length, filler rate, sleep hours, active minutes, twin accuracy. No targets: iamyou sets none | weekly features, baseline |
| 9 | Other relevant clinical data | **Data sources:** number of weeks, sources (voice check-ins, wearable), and whether any data is synthetic | | weekly features |
| 10 | Assessment (clinical interpretation) | **What changed:** plain description of which measures moved, since when and by how much. No interpretation | Shown only when `gate().includeInSummary` is true; otherwise "No change to report." | signal, gate |
| 11 | Plan (treatment, medications) | **What the person would like to discuss:** in their own words | No treatment content | person's input |
| 12 | Actions (optional) | **Right-not-to-know setting:** the person's current choice, stated plainly | e.g. "The person chose to see changes and share them with their clinician." | profile |
| 13 | Questions? [Secure contact] | **Questions:** contact chosen by the person | | profile |
| 14 | (none) | **Footer:** "This is not a diagnosis." | Always present | fixed |
