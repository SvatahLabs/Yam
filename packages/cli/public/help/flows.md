Flows — plain sentences with a signature

A flow file has blocks. A story is the unit of behaviour; a scenario is a
story that runs in file order when there is no run block; compose names a
sequence of stories; test and run say what a run executes.

  story (tags=smoke): Sign in
  inputs: username: string, password: secret
    Go to "/login"
    Type {input.username} into the username field
    Type {input.password} into the password field
    Click the sign in button
    The dashboard heading should be visible

  test: Sign in

Targets are phrases, never selectors: "the username field", "the sign in
button". Values come from {input.name}, {data.path}, {name} for a capture in
this story, or {Story.name} for another story's capture.

Ten sentences that cover most flows:

  Go to "/path"                              Click the sign in button
  Type "text" into the username field        Select "Option" in the country select
  Press Enter                                 Wait for the dashboard heading to be visible
  The page title should contain "Home"        The URL should contain "/dashboard"
  Remember the text of the total as amount    Only if the cookie banner is visible, Click the accept button

Guards: "Only if <predicate>, <sentence>" and "Unless …" skip a step without
acting. A story's onFailure is stop, continue or compensate:<story>; idempotent
is what lets a story be exposed to an agent in production.

Every pattern, with two examples each, is in the flow language reference:
docs/flow-language.md in the repository, or https://yam.svatah.com.
