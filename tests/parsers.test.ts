import { describe, expect, it } from 'vitest'
import { parseSessionArtifacts } from '../src/main/parsers'

describe('parseSessionArtifacts', () => {
  it('parses standard messages payload', () => {
    const raw = JSON.stringify({
      id: 'session-1',
      model: 'gpt-5.3-codex',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' }
      ],
      repoPath: '/tmp/repo'
    })

    const parsed = parseSessionArtifacts(raw, {
      filePath: '/tmp/repo/.copilot/session.json',
      repoRoot: '/tmp/repo',
      source: 'cli'
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].session.id).toBe('session-1')
    expect(parsed[0].messages).toHaveLength(2)
    expect(parsed[0].session.source).toBe('cli')
  })

  it('parses turn-based payload', () => {
    const raw = JSON.stringify({
      turns: [
        { prompt: 'Q1', response: 'A1', timestamp: '2025-01-01T10:00:00.000Z' },
        { prompt: 'Q2', response: 'A2', timestamp: '2025-01-01T10:10:00.000Z' }
      ],
      cwd: '/tmp/repo'
    })

    const parsed = parseSessionArtifacts(raw, {
      filePath: '/tmp/repo/.vscode/copilot-chat.json',
      repoRoot: '/tmp/repo',
      source: 'vscode'
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].messages).toHaveLength(4)
    expect(parsed[0].session.source).toBe('vscode')
  })

  it('parses copilot session events.jsonl payload', () => {
    const raw = [
      JSON.stringify({
        type: 'session.start',
        data: {
          sessionId: 'session-events-1',
          copilotVersion: '0.0.420',
          startTime: '2026-03-10T10:00:00.000Z',
          context: { cwd: '/tmp/repo-events' }
        },
        timestamp: '2026-03-10T10:00:00.000Z'
      }),
      JSON.stringify({
        type: 'user.message',
        data: {
          content: 'How does sync work?'
        },
        timestamp: '2026-03-10T10:01:00.000Z'
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: {
          content: 'Sync scans configured roots and indexes sessions.'
        },
        timestamp: '2026-03-10T10:01:10.000Z'
      }),
      JSON.stringify({
        type: 'tool.execution_complete',
        data: {
          model: 'gpt-5.3-codex'
        },
        timestamp: '2026-03-10T10:01:11.000Z'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.copilot/session-state/session-events-1/events.jsonl',
      repoRoot: '/tmp/repo-events',
      source: 'cli'
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].session.id).toBe('session-events-1')
    expect(parsed[0].session.repoPath).toBe('/tmp/repo-events')
    expect(parsed[0].session.source).toBe('vscode')
    expect(parsed[0].session.model).toBe('gpt-5.3-codex')
    expect(parsed[0].messages).toHaveLength(2)
  })

  it('infers CLI source from copilot semver in events payload', () => {
    const raw = [
      JSON.stringify({
        type: 'session.start',
        data: {
          sessionId: 'session-events-cli',
          copilotVersion: '1.0.3',
          startTime: '2026-03-10T10:00:00.000Z',
          context: { cwd: '/tmp/repo-events' }
        },
        timestamp: '2026-03-10T10:00:00.000Z'
      }),
      JSON.stringify({
        type: 'user.message',
        data: { content: 'hello' },
        timestamp: '2026-03-10T10:01:00.000Z'
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'world' },
        timestamp: '2026-03-10T10:01:01.000Z'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.copilot/session-state/session-events-cli/events.jsonl',
      repoRoot: '/tmp/repo-events',
      source: 'cli'
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].session.source).toBe('cli')
  })

  it('detects custom CLI agent from events payload', () => {
    const raw = [
      JSON.stringify({
        type: 'session.start',
        data: {
          sessionId: 'session-events-custom-agent',
          producer: 'copilot-agent',
          copilotVersion: '1.0.7',
          startTime: '2026-03-10T10:00:00.000Z',
          context: { cwd: '/tmp/repo-events' }
        },
        timestamp: '2026-03-10T10:00:00.000Z'
      }),
      JSON.stringify({
        type: 'user.message',
        data: { content: 'run the workflow' },
        timestamp: '2026-03-10T10:00:01.000Z'
      }),
      JSON.stringify({
        type: 'subagent.started',
        data: {
          agentName: 'security-upgrade-agent',
          agentDisplayName: 'security-upgrade-agent'
        },
        timestamp: '2026-03-10T10:00:02.000Z'
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'Running security-upgrade-agent now.' },
        timestamp: '2026-03-10T10:00:03.000Z'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.copilot/session-state/session-events-custom-agent/events.jsonl',
      repoRoot: '/tmp/repo-events',
      source: 'cli'
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].session.source).toBe('cli')
    expect(parsed[0].session.agent).toBe('security-upgrade-agent')
    expect(parsed[0].session.isSubagentSession).toBe(false)
  })

  it('detects custom CLI agent from transformed instructions without marking the session as a sub-agent', () => {
    const raw = [
      JSON.stringify({
        type: 'session.start',
        data: {
          sessionId: 'session-events-custom-agent-fallback',
          producer: 'copilot-agent',
          copilotVersion: '1.0.9',
          startTime: '2026-03-10T10:00:00.000Z',
          context: { cwd: '/tmp/repo-events' }
        },
        timestamp: '2026-03-10T10:00:00.000Z'
      }),
      JSON.stringify({
        type: 'user.message',
        data: {
          content: 'let us continue',
          transformedContent:
            '<agent_instructions>\n# Any removal-first migration agent\n\nFollow these instructions.\n</agent_instructions>'
        },
        timestamp: '2026-03-10T10:00:01.000Z'
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'Continuing now.' },
        timestamp: '2026-03-10T10:00:02.000Z'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.copilot/session-state/session-events-custom-agent-fallback/events.jsonl',
      repoRoot: '/tmp/repo-events',
      source: 'cli'
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].session.source).toBe('cli')
    expect(parsed[0].session.agent).toBe('any-removal-first-migration-agent')
    expect(parsed[0].session.isSubagentSession).toBe(false)
    expect(parsed[0].messages[0]?.content).toBe('let us continue')
  })

  it('does not mark later custom-agent turns in a CLI session as a sub-agent session', () => {
    const raw = [
      JSON.stringify({
        type: 'session.start',
        data: {
          sessionId: 'session-events-later-custom-agent',
          producer: 'copilot-agent',
          copilotVersion: '1.0.39',
          startTime: '2026-03-10T10:00:00.000Z',
          context: { cwd: '/tmp/repo-events' }
        },
        timestamp: '2026-03-10T10:00:00.000Z'
      }),
      JSON.stringify({
        type: 'user.message',
        data: { content: 'fix the flaky test' },
        timestamp: '2026-03-10T10:00:01.000Z'
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'I will investigate it.' },
        timestamp: '2026-03-10T10:00:02.000Z'
      }),
      JSON.stringify({
        type: 'user.message',
        data: {
          content: 'review PR #123',
          transformedContent:
            '<agent_instructions>\n# Frontend Code Review Agent\n\nReview the PR.\n</agent_instructions>'
        },
        timestamp: '2026-03-10T10:10:00.000Z'
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'Reviewing now.' },
        timestamp: '2026-03-10T10:10:01.000Z'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.copilot/session-state/session-events-later-custom-agent/events.jsonl',
      repoRoot: '/tmp/repo-events',
      source: 'cli'
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].session.source).toBe('cli')
    expect(parsed[0].session.agent).toBe('frontend-code-review-agent')
    expect(parsed[0].session.isSubagentSession).toBe(false)
  })

  it('marks CLI event sessions with session-level parent linkage as sub-agent sessions', () => {
    const raw = [
      JSON.stringify({
        type: 'session.start',
        data: {
          sessionId: 'session-events-parented',
          producer: 'copilot-agent',
          copilotVersion: '1.0.31',
          startTime: '2026-03-10T10:00:00.000Z',
          context: { cwd: '/tmp/repo-events' }
        },
        timestamp: '2026-03-10T10:00:00.000Z',
        parentId: 'parent-session-1'
      }),
      JSON.stringify({
        type: 'user.message',
        data: { content: 'continue the task' },
        timestamp: '2026-03-10T10:00:01.000Z'
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'Continuing now.' },
        timestamp: '2026-03-10T10:00:02.000Z'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.copilot/session-state/session-events-parented/events.jsonl',
      repoRoot: '/tmp/repo-events',
      source: 'cli'
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].session.isSubagentSession).toBe(true)
    expect(parsed[0].session.parentSessionId).toBe('parent-session-1')
  })

  it('prefers multiline transformed user content when it matches collapsed content', () => {
    const raw = [
      JSON.stringify({
        type: 'session.start',
        data: {
          sessionId: 'session-events-multiline-user-content',
          producer: 'copilot-agent',
          copilotVersion: '1.0.21',
          startTime: '2026-03-10T10:00:00.000Z',
          context: { cwd: '/tmp/repo-events' }
        },
        timestamp: '2026-03-10T10:00:00.000Z'
      }),
      JSON.stringify({
        type: 'user.message',
        data: {
          content:
            "The typecheck failures are fine for now. Here's what I want you to do next: - run the typecheck again - group the failures by CODEOWNERS - create subtasks after that",
          transformedContent:
            "<current_datetime>2026-03-10T10:00:01.000Z</current_datetime>\n\n[[PLAN]] The typecheck failures are fine for now. Here's what I want you to do next:\n- run the typecheck again\n- group the failures by CODEOWNERS\n- create subtasks after that"
        },
        timestamp: '2026-03-10T10:00:01.000Z'
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'Got it.' },
        timestamp: '2026-03-10T10:00:05.000Z'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.copilot/session-state/session-events-multiline-user-content/events.jsonl',
      repoRoot: '/tmp/repo-events',
      source: 'cli'
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].messages[0]?.content).toBe(
      "The typecheck failures are fine for now. Here's what I want you to do next:\n- run the typecheck again\n- group the failures by CODEOWNERS\n- create subtasks after that"
    )
    expect(parsed[0].messages[0]?.mode).toBe('plan')
  })

  it('reconstructs flattened plan request bullets from transformed content', () => {
    const raw = [
      JSON.stringify({
        type: 'session.start',
        data: {
          sessionId: 'session-events-flattened-plan-request',
          producer: 'copilot-agent',
          copilotVersion: '1.0.21',
          startTime: '2026-03-10T10:00:00.000Z',
          context: { cwd: '/tmp/repo-events' }
        },
        timestamp: '2026-03-10T10:00:00.000Z'
      }),
      JSON.stringify({
        type: 'user.message',
        data: {
          content:
            "The typecheck failures are fine for now. I reverted your change to make it pass forcefully. Here's what I want you to do next: - run the typecheck again, from the result, prepare a list of files that have typecheck failures - these will ALL be test files only. - next, I want you to use CODEOWNERS file to group them based on which code owners group owns which set of files.. and save that to a .txt file for my reference later as well - after that, for each group, I want you to create JIRA tickets in form of subtasks in the FG-176 ticket using acli.",
          transformedContent:
            "<current_datetime>2026-03-10T10:00:01.000Z</current_datetime>\n\n[[PLAN]] I want to create an implementation plan. Please:\n1. Analyze the codebase to understand the current state\n2. Ask clarifying questions if my request is ambiguous\n3. Create a structured plan and save it to the plan file in the session folder\n\nMy request: The typecheck failures are fine for now. I reverted your change to make it pass forcefully. Here's what I want you to do next: - run the typecheck again, from the result, prepare a list of files that have typecheck failures - these will ALL be test files only. - next, I want you to use CODEOWNERS file to group them based on which code owners group owns which set of files.. and save that to a .txt file for my reference later as well - after that, for each group, I want you to create JIRA tickets in form of subtasks in the FG-176 ticket using acli."
        },
        timestamp: '2026-03-10T10:00:01.000Z'
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'Got it.' },
        timestamp: '2026-03-10T10:00:05.000Z'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.copilot/session-state/session-events-flattened-plan-request/events.jsonl',
      repoRoot: '/tmp/repo-events',
      source: 'cli'
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].messages[0]?.content).toBe(
      "The typecheck failures are fine for now. I reverted your change to make it pass forcefully. Here's what I want you to do next:\n- run the typecheck again, from the result, prepare a list of files that have typecheck failures\n- these will ALL be test files only.\n- next, I want you to use CODEOWNERS file to group them based on which code owners group owns which set of files.. and save that to a .txt file for my reference later as well\n- after that, for each group, I want you to create JIRA tickets in form of subtasks in the FG-176 ticket using acli."
    )
    expect(parsed[0].messages[0]?.mode).toBe('plan')
  })

  it('reconstructs readable paragraphs for long flattened plan requests', () => {
    const raw = [
      JSON.stringify({
        type: 'session.start',
        data: {
          sessionId: 'session-events-flattened-plan-paragraphs',
          producer: 'copilot-agent',
          copilotVersion: '1.0.21',
          startTime: '2026-03-10T10:00:00.000Z',
          context: { cwd: '/tmp/repo-events' }
        },
        timestamp: '2026-03-10T10:00:00.000Z'
      }),
      JSON.stringify({
        type: 'user.message',
        data: {
          content:
            'We are working on rebranding "Airbase" with "Paylocity for Finance" and the current task at hand is for logos/icons. The audit was done for this re-brand a few weeks ago and it sits in the src/docs directory. I want us to explore how we can prepare a small framework of sorts which can help us switch to using the new logos instead of old. Another thing is, we have an LD flag added for this which will help us decide. There\'s one caveat though, I think on login pages, card share page and other such pages we won\'t be able to use launchdarkly flags IIRC. Thinking out loud here -> If stage.airbase.io or airbase.pages.dev URLs, then show PCTY4FIN icons otherwise Airbase - this is for testing on staging/review app. Not sure, validate this thought while at it. let\'s prepare a plan for this, /grill-me with questions',
          transformedContent:
            '<current_datetime>2026-03-10T10:00:01.000Z</current_datetime>\n\n[[PLAN]] I want to create an implementation plan. Please:\n1. Analyze the codebase to understand the current state\n2. Ask clarifying questions if my request is ambiguous\n3. Create a structured plan and save it to the plan file in the session folder\n\nMy request: We are working on rebranding "Airbase" with "Paylocity for Finance" and the current task at hand is for logos/icons. The audit was done for this re-brand a few weeks ago and it sits in the src/docs directory. I want us to explore how we can prepare a small framework of sorts which can help us switch to using the new logos instead of old. Another thing is, we have an LD flag added for this which will help us decide. There\'s one caveat though, I think on login pages, card share page and other such pages we won\'t be able to use launchdarkly flags IIRC. Thinking out loud here -> If stage.airbase.io or airbase.pages.dev URLs, then show PCTY4FIN icons otherwise Airbase - this is for testing on staging/review app. Not sure, validate this thought while at it. let\'s prepare a plan for this, /grill-me with questions'
        },
        timestamp: '2026-03-10T10:00:01.000Z'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.copilot/session-state/session-events-flattened-plan-paragraphs/events.jsonl',
      repoRoot: '/tmp/repo-events',
      source: 'cli'
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].messages[0]?.content).toBe(
      'We are working on rebranding "Airbase" with "Paylocity for Finance" and the current task at hand is for logos/icons. The audit was done for this re-brand a few weeks ago and it sits in the src/docs directory. I want us to explore how we can prepare a small framework of sorts which can help us switch to using the new logos instead of old.\n\nAnother thing is, we have an LD flag added for this which will help us decide.\n\nThere\'s one caveat though, I think on login pages, card share page and other such pages we won\'t be able to use launchdarkly flags IIRC.\n\nThinking out loud here -> If stage.airbase.io or airbase.pages.dev URLs, then show PCTY4FIN icons otherwise Airbase - this is for testing on staging/review app.\n\nNot sure, validate this thought while at it.\n\nlet\'s prepare a plan for this, /grill-me with questions'
    )
    expect(parsed[0].messages[0]?.format).toBe('markdown')
    expect(parsed[0].messages[0]?.mode).toBe('plan')
  })

  it('detects plan and autopilot modes from CLI events', () => {
    const raw = [
      JSON.stringify({
        type: 'session.start',
        data: {
          sessionId: 'session-events-mode-flow',
          producer: 'copilot-agent',
          copilotVersion: '1.0.11',
          startTime: '2026-03-10T10:00:00.000Z',
          context: { cwd: '/tmp/repo-events' }
        },
        timestamp: '2026-03-10T10:00:00.000Z'
      }),
      JSON.stringify({
        type: 'user.message',
        data: {
          content: 'Please inspect this feature first.',
          transformedContent:
            '<current_datetime>2026-03-10T10:00:01.000Z</current_datetime>\n\n[[PLAN]] Please create a plan first.'
        },
        timestamp: '2026-03-10T10:00:01.000Z'
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'I will put together a plan.' },
        timestamp: '2026-03-10T10:00:05.000Z'
      }),
      JSON.stringify({
        type: 'hook.start',
        data: {
          input: {
            toolName: 'exit_plan_mode',
            toolResult: {
              textResultForLlm:
                'Plan approved! Exited plan mode.\n\nYou are now in autopilot mode (edits will be auto-approved).'
            }
          }
        },
        timestamp: '2026-03-10T10:02:00.000Z'
      }),
      JSON.stringify({
        type: 'user.message',
        data: {
          content: 'Great, implement it now.',
          agentMode: 'autopilot'
        },
        timestamp: '2026-03-10T10:02:10.000Z'
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'Working on the implementation now.' },
        timestamp: '2026-03-10T10:02:20.000Z'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.copilot/session-state/session-events-mode-flow/events.jsonl',
      repoRoot: '/tmp/repo-events',
      source: 'cli'
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].session.modes).toEqual(['plan', 'autopilot'])
    expect(parsed[0].session.latestMode).toBe('autopilot')
    expect(parsed[0].messages[0]?.mode).toBe('plan')
    expect(parsed[0].messages[2]?.mode).toBe('autopilot')
  })

  it('uses CLI summary hints for events session title', () => {
    const raw = [
      JSON.stringify({
        type: 'session.start',
        data: {
          sessionId: 'session-events-cli-title',
          copilotVersion: '1.0.4',
          startTime: '2026-03-10T10:00:00.000Z',
          context: { cwd: '/tmp/repo-events' }
        },
        timestamp: '2026-03-10T10:00:00.000Z'
      }),
      JSON.stringify({
        type: 'user.message',
        data: {
          content:
            'I have a very long request that should not be used as the list title when a concise CLI summary exists.'
        },
        timestamp: '2026-03-10T10:01:00.000Z'
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'Done.' },
        timestamp: '2026-03-10T10:01:01.000Z'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.copilot/session-state/session-events-cli-title/events.jsonl',
      repoRoot: '/tmp/repo-events',
      source: 'cli',
      cliSummaryBySessionId: new Map([
        ['session-events-cli-title', 'Fix Sidebar Filter Layout']
      ])
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].session.source).toBe('cli')
    expect(parsed[0].session.title).toBe('Fix Sidebar Filter Layout')
  })

  it('honors opencode source hint in generic payload', () => {
    const raw = JSON.stringify({
      id: 'open-session-1',
      source: 'opencode',
      model: 'gpt-5.3-codex',
      repoPath: '/tmp/opencode-repo',
      messages: [
        { role: 'user', content: 'Help me debug this parser' },
        { role: 'assistant', content: 'Sure, share the failing test.' }
      ]
    })

    const parsed = parseSessionArtifacts(raw, {
      filePath: '/tmp/opencode-repo/.opencode/session.json',
      repoRoot: '/tmp/opencode-repo',
      source: 'opencode'
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].session.source).toBe('opencode')
  })

  it('parses VS Code workspace chatSessions JSONL format', () => {
    const raw = [
      JSON.stringify({
        kind: 0,
        v: {
          version: 3,
          creationDate: 1773303028706,
          sessionId: 'vscode-chat-1',
          customTitle: 'Investigate failing test',
          requests: [],
          inputState: {
            selectedModel: {
              identifier: 'copilot/claude-sonnet-4.6'
            }
          }
        }
      }),
      JSON.stringify({
        kind: 2,
        k: ['requests'],
        v: [
          {
            requestId: 'request-1',
            timestamp: 1773306051847,
            modelId: 'copilot/claude-sonnet-4.6',
            message: { text: 'Why is this test flaky?' },
            variableData: {
              variables: [
                {
                  kind: 'file',
                  value: {
                    uri: { fsPath: '/tmp/repo-vscode/src/index.tsx' },
                    range: {
                      startLineNumber: 48,
                      endLineNumber: 52
                    }
                  }
                }
              ]
            },
            response: [{ kind: 'mcpServersStarting', didStartServerIds: [] }]
          }
        ]
      }),
      JSON.stringify({
        kind: 2,
        k: ['requests', 0, 'response'],
        v: [
          {
            value: 'The test is flaky due to a race condition in async setup.'
          },
          { value: '```' },
          {
            kind: 'codeblockUri',
            uri: { fsPath: '/tmp/repo-vscode/src/index.tsx' },
            isEdit: true
          },
          {
            kind: 'textEditGroup',
            uri: { fsPath: '/tmp/repo-vscode/src/index.tsx' },
            edits: [
              [
                {
                  text: 'initPreload',
                  range: {
                    startLineNumber: 88,
                    endLineNumber: 88,
                    startColumn: 29,
                    endColumn: 48
                  }
                }
              ],
              []
            ],
            done: true
          },
          { value: '```' },
          {
            value:
              'Pass `initPreload` directly instead of wrapping in an inline callback.'
          }
        ]
      }),
      JSON.stringify({
        kind: 2,
        k: ['requests'],
        v: [
          {
            requestId: 'request-2',
            timestamp: 1773307051847,
            modelId: 'copilot/claude-sonnet-4.6',
            message: { text: 'What is the fix?' },
            response: []
          }
        ]
      }),
      JSON.stringify({
        kind: 2,
        k: ['requests', 1, 'response'],
        v: [
          {
            value:
              'Wrap the navigation in flushSync or move it to an effect after state settles.'
          }
        ]
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/Library/Application Support/Code/User/workspaceStorage/ws/chatSessions/vscode-chat-1.jsonl',
      repoRoot: '/tmp/repo-vscode',
      source: 'vscode'
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].session.id).toBe('vscode-chat-1')
    expect(parsed[0].session.source).toBe('vscode')
    expect(parsed[0].session.repoPath).toBe('/tmp/repo-vscode')
    expect(parsed[0].session.model).toBe('copilot/claude-sonnet-4.6')
    expect(parsed[0].messages).toHaveLength(4)
    expect(parsed[0].messages[0].role).toBe('user')
    expect(parsed[0].messages[0].references).toEqual([
      { path: '/tmp/repo-vscode/src/index.tsx', startLine: 48, endLine: 52 }
    ])
    expect(parsed[0].messages[1].role).toBe('assistant')
    expect(parsed[0].messages[1].content).toContain('race condition')
    expect(parsed[0].messages[1].content).toContain(
      'Pass `initPreload` directly'
    )
    expect(parsed[0].messages[1].content).not.toContain('```')
    expect(parsed[0].messages[1].edits).toEqual([
      {
        path: '/tmp/repo-vscode/src/index.tsx',
        startLine: 88,
        endLine: 88,
        addedLines: 1,
        removedLines: 1
      }
    ])
    expect(parsed[0].messages[2].content).toContain('What is the fix?')
    expect(parsed[0].messages[3].content).toContain('flushSync')
  })

  it('preserves VS Code inline file references inside assistant text', () => {
    const raw = [
      JSON.stringify({
        kind: 0,
        v: {
          version: 3,
          creationDate: 1773303028706,
          sessionId: 'vscode-inline-ref-1',
          customTitle: 'Inline reference preservation',
          requests: []
        }
      }),
      JSON.stringify({
        kind: 2,
        k: ['requests'],
        v: [
          {
            requestId: 'request-inline-ref-1',
            timestamp: 1773306051847,
            modelId: 'copilot/gpt-5.4',
            message: { text: 'Where is the fix?' },
            response: []
          }
        ]
      }),
      JSON.stringify({
        kind: 2,
        k: ['requests', 0, 'response'],
        v: [
          { value: 'The fix is in' },
          {
            kind: 'inlineReference',
            name: 'src/dashboard/withCommonProps.tsx',
            inlineReference: {
              fsPath: '/tmp/repo-vscode/src/dashboard/withCommonProps.tsx'
            }
          },
          { value: '. I replaced the wrapper.' }
        ]
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/Library/Application Support/Code/User/workspaceStorage/ws/chatSessions/vscode-inline-ref-1.jsonl',
      repoRoot: '/tmp/repo-vscode',
      source: 'vscode'
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].messages[1].content).toBe(
      'The fix is in `withCommonProps.tsx`. I replaced the wrapper.'
    )
  })

  it('extracts token usage from the last session.shutdown event', () => {
    const raw = [
      JSON.stringify({
        type: 'session.start',
        data: {
          sessionId: 'session-with-shutdown',
          copilotVersion: '1.0.31',
          startTime: '2026-04-17T03:41:51.081Z',
          context: { cwd: '/tmp/repo-shutdown' }
        },
        timestamp: '2026-04-17T03:41:51.090Z'
      }),
      JSON.stringify({
        type: 'user.message',
        data: { content: 'Hello' },
        timestamp: '2026-04-17T03:42:00.000Z'
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'Hi.' },
        timestamp: '2026-04-17T03:42:05.000Z'
      }),
      JSON.stringify({
        type: 'session.shutdown',
        data: {
          shutdownType: 'routine',
          modelMetrics: {
            'gpt-5.4': {
              requests: { count: 8, cost: 1 },
              usage: {
                inputTokens: 249568,
                outputTokens: 4904,
                cacheReadTokens: 211328,
                cacheWriteTokens: 0,
                reasoningTokens: 3167
              }
            }
          }
        },
        timestamp: '2026-04-17T14:54:27.439Z'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.copilot/session-state/session-with-shutdown/events.jsonl',
      repoRoot: '/tmp/repo-shutdown',
      source: 'cli'
    })

    expect(parsed).toHaveLength(1)
    const usage = parsed[0].session.tokenUsage
    expect(usage).toBeDefined()
    expect(usage?.source).toBe('cli-shutdown')
    expect(usage?.byModel).toEqual([
      {
        modelId: 'gpt-5.4',
        inputTokens: 249568,
        cachedInputTokens: 211328,
        cacheWriteTokens: 0,
        cacheWrite1hTokens: 0,
        outputTokens: 4904,
        reasoningTokens: 3167,
        requestCount: 8
      }
    ])
    expect(usage?.totals).toEqual({
      inputTokens: 249568,
      cachedInputTokens: 211328,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 4904,
      reasoningTokens: 3167
    })
  })

  it('marks tokenUsage as unavailable when no session.shutdown is recorded', () => {
    const raw = [
      JSON.stringify({
        type: 'session.start',
        data: {
          sessionId: 'session-no-shutdown',
          copilotVersion: '1.0.31',
          startTime: '2026-04-17T03:41:51.081Z',
          context: { cwd: '/tmp/repo-no-shutdown' }
        },
        timestamp: '2026-04-17T03:41:51.090Z'
      }),
      JSON.stringify({
        type: 'user.message',
        data: { content: 'In progress' },
        timestamp: '2026-04-17T03:42:00.000Z'
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'OK' },
        timestamp: '2026-04-17T03:42:05.000Z'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.copilot/session-state/session-no-shutdown/events.jsonl',
      repoRoot: '/tmp/repo-no-shutdown',
      source: 'cli'
    })

    expect(parsed[0].session.tokenUsage).toEqual({
      source: 'unavailable',
      byModel: [],
      totals: {
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        cacheWrite1hTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0
      }
    })
  })

  it('sums all session.shutdown events when multiple are present (resumed sessions)', () => {
    const raw = [
      JSON.stringify({
        type: 'session.start',
        data: {
          sessionId: 'session-resumed',
          copilotVersion: '1.0.31',
          startTime: '2026-04-17T03:41:51.081Z',
          context: { cwd: '/tmp/repo-resumed' }
        },
        timestamp: '2026-04-17T03:41:51.090Z'
      }),
      JSON.stringify({
        type: 'user.message',
        data: { content: 'Hi' },
        timestamp: '2026-04-17T03:42:00.000Z'
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'Hi.' },
        timestamp: '2026-04-17T03:42:05.000Z'
      }),
      JSON.stringify({
        type: 'session.shutdown',
        data: {
          modelMetrics: {
            'gpt-5.4': {
              requests: { count: 1, cost: 0 },
              usage: {
                inputTokens: 100,
                outputTokens: 10,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                reasoningTokens: 0
              }
            }
          }
        },
        timestamp: '2026-04-17T05:00:00.000Z'
      }),
      JSON.stringify({
        type: 'session.shutdown',
        data: {
          modelMetrics: {
            'gpt-5.4': {
              requests: { count: 5, cost: 1 },
              usage: {
                inputTokens: 5000,
                outputTokens: 500,
                cacheReadTokens: 1000,
                cacheWriteTokens: 0,
                reasoningTokens: 100
              }
            }
          }
        },
        timestamp: '2026-04-17T08:00:00.000Z'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath: '/Users/me/.copilot/session-state/session-resumed/events.jsonl',
      repoRoot: '/tmp/repo-resumed',
      source: 'cli'
    })

    expect(parsed[0].session.tokenUsage?.byModel[0]).toMatchObject({
      modelId: 'gpt-5.4',
      inputTokens: 5100,
      outputTokens: 510,
      cachedInputTokens: 1000,
      reasoningTokens: 100,
      requestCount: 6
    })
  })

  it('preserves a per-model array when modelMetrics has multiple models', () => {
    const raw = [
      JSON.stringify({
        type: 'session.start',
        data: {
          sessionId: 'session-multi-model',
          copilotVersion: '1.0.31',
          startTime: '2026-04-17T03:41:51.081Z',
          context: { cwd: '/tmp/repo-multi' }
        },
        timestamp: '2026-04-17T03:41:51.090Z'
      }),
      JSON.stringify({
        type: 'user.message',
        data: { content: 'Hi' },
        timestamp: '2026-04-17T03:42:00.000Z'
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'Hi.' },
        timestamp: '2026-04-17T03:42:05.000Z'
      }),
      JSON.stringify({
        type: 'session.shutdown',
        data: {
          modelMetrics: {
            'gpt-5.4': {
              requests: { count: 4, cost: 1 },
              usage: {
                inputTokens: 1000,
                outputTokens: 200,
                cacheReadTokens: 500,
                cacheWriteTokens: 0,
                reasoningTokens: 50
              }
            },
            'claude-opus-4.7': {
              requests: { count: 2, cost: 1 },
              usage: {
                inputTokens: 800,
                outputTokens: 100,
                cacheReadTokens: 0,
                cacheWriteTokens: 200,
                reasoningTokens: 30
              }
            }
          }
        },
        timestamp: '2026-04-17T08:00:00.000Z'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.copilot/session-state/session-multi-model/events.jsonl',
      repoRoot: '/tmp/repo-multi',
      source: 'cli'
    })

    const usage = parsed[0].session.tokenUsage
    expect(usage?.byModel).toHaveLength(2)
    const byId = Object.fromEntries(
      (usage?.byModel ?? []).map(m => [m.modelId, m])
    )
    expect(byId['gpt-5.4'].inputTokens).toBe(1000)
    expect(byId['claude-opus-4.7'].cacheWriteTokens).toBe(200)
    expect(usage?.totals).toEqual({
      inputTokens: 1800,
      cachedInputTokens: 500,
      cacheWriteTokens: 200,
      cacheWrite1hTokens: 0,
      outputTokens: 300,
      reasoningTokens: 80
    })
  })
})

describe('Claude Code sessions', () => {
  it('parses a user/assistant exchange from a Claude Code project log', () => {
    const raw = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        isSidechain: false,
        message: { role: 'user', content: 'Can you fix the bug?' },
        timestamp: '2026-01-01T10:00:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-1',
        permissionMode: 'default',
        version: '2.1.181',
        gitBranch: 'main'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        isSidechain: false,
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'Sure, fixed it.' }]
        },
        timestamp: '2026-01-01T10:00:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-1',
        version: '2.1.181',
        gitBranch: 'main'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.claude/projects/-tmp-repo-claude/session-claude-1.jsonl',
      repoRoot: '/tmp/repo-claude',
      source: 'claude'
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].session.id).toBe('session-claude-1')
    expect(parsed[0].session.source).toBe('claude')
    expect(parsed[0].session.repoPath).toBe('/tmp/repo-claude')
    expect(parsed[0].session.model).toBe('claude-sonnet-4-6')
    expect(parsed[0].messages).toHaveLength(2)
    expect(parsed[0].messages[0]).toMatchObject({
      role: 'user',
      content: 'Can you fix the bug?'
    })
    expect(parsed[0].messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Sure, fixed it.'
    })
  })

  it('links a file-backed subagent log to its enclosing Claude session', () => {
    const raw = [
      JSON.stringify({
        type: 'user',
        uuid: 'subagent-u1',
        message: { role: 'user', content: 'Investigate the issue.' },
        timestamp: '2026-01-01T10:00:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'subagent-session'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'subagent-a1',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'Investigation complete.' }]
        },
        timestamp: '2026-01-01T10:00:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'subagent-session'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.claude/projects/-tmp-repo-claude/session-parent/subagents/subagent-session.jsonl',
      repoRoot: '/tmp/repo-claude',
      source: 'claude'
    })

    expect(parsed[0].session).toMatchObject({
      isSubagentSession: true,
      parentSessionId: 'session-parent'
    })
    expect(parsed[0].session.id).not.toBe('session-parent')
    expect(parsed[0].session.id).not.toBe('subagent-session')
  })

  it('skips a "user" turn whose content is only a tool_result block', () => {
    const raw = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: 'Run the tests' },
        timestamp: '2026-01-01T10:00:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-2'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Bash',
              input: { command: 'npm test' }
            }
          ]
        },
        timestamp: '2026-01-01T10:00:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-2'
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u2',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: 'All tests passed.'
            }
          ]
        },
        timestamp: '2026-01-01T10:00:06.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-2'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a2',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'All tests passed.' }]
        },
        timestamp: '2026-01-01T10:00:07.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-2'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.claude/projects/-tmp-repo-claude/session-claude-2.jsonl',
      repoRoot: '/tmp/repo-claude',
      source: 'claude'
    })

    expect(parsed).toHaveLength(1)
    // The tool_use-only assistant turn and the tool_result-only user turn
    // both have no human-readable text and should not appear as messages.
    expect(parsed[0].messages).toHaveLength(2)
    expect(parsed[0].messages[0]).toMatchObject({
      role: 'user',
      content: 'Run the tests'
    })
    expect(parsed[0].messages[1]).toMatchObject({
      role: 'assistant',
      content: 'All tests passed.'
    })
  })

  it('captures a thinking block alongside the assistant text', () => {
    const raw = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: 'Why does this fail?' },
        timestamp: '2026-01-01T10:00:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-thinking'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [
            {
              type: 'thinking',
              thinking: 'Let me trace the stack trace first.'
            },
            {
              type: 'text',
              text: 'It fails because the index is out of range.'
            }
          ]
        },
        timestamp: '2026-01-01T10:00:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-thinking'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.claude/projects/-tmp-repo-claude/session-claude-thinking.jsonl',
      repoRoot: '/tmp/repo-claude',
      source: 'claude'
    })

    expect(parsed[0].messages[1]).toMatchObject({
      role: 'assistant',
      content: 'It fails because the index is out of range.',
      thinking: 'Let me trace the stack trace first.'
    })
  })

  it('keeps a thinking-only assistant message instead of dropping it', () => {
    const raw = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: 'Investigate this.' },
        timestamp: '2026-01-01T10:00:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-thinking-only'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [
            { type: 'thinking', thinking: 'Considering the right approach...' }
          ]
        },
        timestamp: '2026-01-01T10:00:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-thinking-only'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.claude/projects/-tmp-repo-claude/session-claude-thinking-only.jsonl',
      repoRoot: '/tmp/repo-claude',
      source: 'claude'
    })

    expect(parsed[0].messages).toHaveLength(2)
    expect(parsed[0].messages[1]).toMatchObject({
      role: 'assistant',
      content: '',
      thinking: 'Considering the right approach...'
    })
  })

  it('prefers the ai-title event over the first user message for the title', () => {
    const raw = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        message: {
          role: 'user',
          content:
            'can you read the code and open the sip-rebalance/ page locally?'
        },
        timestamp: '2026-01-01T10:00:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-title'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'Opening it now.' }]
        },
        timestamp: '2026-01-01T10:00:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-title'
      }),
      JSON.stringify({
        type: 'ai-title',
        aiTitle: 'Open sip-rebalance page locally',
        sessionId: 'session-claude-title'
      }),
      JSON.stringify({
        type: 'custom-title',
        customTitle: 'Local SIP rebalance investigation',
        sessionId: 'session-claude-title'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.claude/projects/-tmp-repo-claude/session-claude-title.jsonl',
      repoRoot: '/tmp/repo-claude',
      source: 'claude'
    })

    expect(parsed[0].session.title).toBe('Local SIP rebalance investigation')
    expect(parsed[0].session.createdAt).toBe('2026-01-01T10:00:00.000Z')
    expect(parsed[0].session.updatedAt).toBe('2026-01-01T10:00:05.000Z')
  })

  it('uses the Claude command name for command-wrapper session titles', () => {
    const commandMessage =
      '<command-message>insights</command-message> ' +
      '<command-name>/insights</command-name> ' +
      '<command-args></command-args>'
    const raw = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: commandMessage },
        timestamp: '2026-01-01T10:00:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-command'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'Here is the report.' }]
        },
        timestamp: '2026-01-01T10:00:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-command'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.claude/projects/-tmp-repo-claude/session-claude-command.jsonl',
      repoRoot: '/tmp/repo-claude',
      source: 'claude'
    })

    expect(parsed[0].session.title).toBe('/insights')
    expect(parsed[0].messages[0].content).toBe(commandMessage)
  })

  it('falls back to the command message when the Claude command name is absent', () => {
    const raw = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        message: {
          role: 'user',
          content: '<command-message>insights</command-message>'
        },
        timestamp: '2026-01-01T10:00:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-command-fallback'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Here is the report.' }]
        },
        timestamp: '2026-01-01T10:00:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-command-fallback'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.claude/projects/-tmp-repo-claude/session-claude-command-fallback.jsonl',
      repoRoot: '/tmp/repo-claude',
      source: 'claude'
    })

    expect(parsed[0].session.title).toBe('/insights')
  })

  it('maps Claude plan mode to plan; acceptEdits and default get no mode (Claude Code has no autopilot)', () => {
    const raw = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: 'First, make a plan.' },
        timestamp: '2026-01-01T10:00:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-modes',
        permissionMode: 'plan'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'Here is the plan.' }]
        },
        timestamp: '2026-01-01T10:00:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-modes'
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u2',
        message: { role: 'user', content: 'Looks good, go ahead.' },
        timestamp: '2026-01-01T10:01:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-modes',
        permissionMode: 'acceptEdits'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a2',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'Implementing now.' }]
        },
        timestamp: '2026-01-01T10:01:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-modes'
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u3',
        message: { role: 'user', content: 'One more thing.' },
        timestamp: '2026-01-01T10:02:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-modes',
        permissionMode: 'default'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.claude/projects/-tmp-repo-claude/session-claude-modes.jsonl',
      repoRoot: '/tmp/repo-claude',
      source: 'claude'
    })

    expect(parsed[0].messages[0]?.mode).toBe('plan')
    // acceptEdits is a permission setting, not autopilot — Claude has no such mode.
    expect(parsed[0].messages[2]?.mode).toBeUndefined()
    expect(parsed[0].messages[4]?.mode).toBeUndefined()
    expect(parsed[0].session.modes).toEqual(['plan'])
    expect(parsed[0].session.latestMode).toBe('plan')
  })

  it('never labels a Claude acceptEdits turn as autopilot, even standing from the first message with no plan', () => {
    const raw = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: 'Let us build the feature.' },
        timestamp: '2026-01-01T10:00:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-standing-accept',
        permissionMode: 'acceptEdits'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'On it.' }]
        },
        timestamp: '2026-01-01T10:00:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-standing-accept'
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u2',
        message: { role: 'user', content: 'One more thing.' },
        timestamp: '2026-01-01T10:01:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-standing-accept',
        permissionMode: 'default'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.claude/projects/-tmp-repo-claude/session-claude-standing-accept.jsonl',
      repoRoot: '/tmp/repo-claude',
      source: 'claude'
    })

    expect(parsed[0].messages[0]?.mode).toBeUndefined()
    expect(parsed[0].session.modes).toBeUndefined()
    expect(parsed[0].session.latestMode).toBeNull()
  })

  it('does not treat bypassPermissions as an autopilot signal (it is a standing skip-prompts setting, not a plan/autopilot transition)', () => {
    const raw = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: 'Investigate the failing test.' },
        timestamp: '2026-01-01T10:00:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-bypass-permissions',
        permissionMode: 'bypassPermissions'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'Looking into it.' }]
        },
        timestamp: '2026-01-01T10:00:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-bypass-permissions'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.claude/projects/-tmp-repo-claude/session-claude-bypass-permissions.jsonl',
      repoRoot: '/tmp/repo-claude',
      source: 'claude'
    })

    expect(parsed[0].messages[0]?.mode).toBeUndefined()
    expect(parsed[0].session.modes).toBeUndefined()
    expect(parsed[0].session.latestMode).toBeNull()
  })

  it('parses an AskUserQuestion tool call and its answer from the templated result', () => {
    const raw = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: 'Should I push this commit?' },
        timestamp: '2026-01-01T10:00:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-askq'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_ask1',
              name: 'AskUserQuestion',
              input: {
                questions: [
                  {
                    question: 'Push commit 20671ef to origin/master?',
                    header: 'Push to remote',
                    options: [
                      {
                        label: 'Yes, push now',
                        description:
                          'Push the new commit to origin/master on GitHub.'
                      },
                      {
                        label: 'No, hold off',
                        description: 'Keep the commit local for now.'
                      }
                    ],
                    multiSelect: false
                  }
                ]
              }
            }
          ]
        },
        timestamp: '2026-01-01T10:00:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-askq'
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u2',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_ask1',
              content:
                'Your questions have been answered: "Push commit 20671ef to origin/master?"="Yes, push now". You can now continue with these answers in mind.'
            }
          ]
        },
        timestamp: '2026-01-01T10:00:06.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-askq'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a2',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [{ type: 'text', text: 'Pushing now.' }]
        },
        timestamp: '2026-01-01T10:00:07.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-askq'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.claude/projects/-tmp-repo-claude/session-claude-askq.jsonl',
      repoRoot: '/tmp/repo-claude',
      source: 'claude'
    })

    const askMessage = parsed[0].messages.find(
      message => message.questions && message.questions.length > 0
    )
    expect(askMessage?.questions).toEqual([
      {
        question: 'Push commit 20671ef to origin/master?',
        header: 'Push to remote',
        options: [
          {
            label: 'Yes, push now',
            description: 'Push the new commit to origin/master on GitHub.'
          },
          {
            label: 'No, hold off',
            description: 'Keep the commit local for now.'
          }
        ],
        multiSelect: false,
        answer: 'Yes, push now'
      }
    ])
  })

  it('parses the answer when tool_result content is an array of text blocks instead of a plain string', () => {
    const raw = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: 'Should I push this commit?' },
        timestamp: '2026-01-01T10:00:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-askq-array-result'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_ask3',
              name: 'AskUserQuestion',
              input: {
                questions: [
                  {
                    question: 'Push commit 20671ef to origin/master?',
                    header: 'Push to remote',
                    options: [
                      {
                        label: 'Yes, push now',
                        description:
                          'Push the new commit to origin/master on GitHub.'
                      },
                      {
                        label: 'No, hold off',
                        description: 'Keep the commit local for now.'
                      }
                    ],
                    multiSelect: false
                  }
                ]
              }
            }
          ]
        },
        timestamp: '2026-01-01T10:00:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-askq-array-result'
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u2',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_ask3',
              content: [
                {
                  type: 'text',
                  text: 'Your questions have been answered: "Push commit 20671ef to origin/master?"="Yes, push now". You can now continue with these answers in mind.'
                }
              ]
            }
          ]
        },
        timestamp: '2026-01-01T10:00:06.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-askq-array-result'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.claude/projects/-tmp-repo-claude/session-claude-askq-array-result.jsonl',
      repoRoot: '/tmp/repo-claude',
      source: 'claude'
    })

    const askMessage = parsed[0].messages.find(
      message => message.questions && message.questions.length > 0
    )
    expect(askMessage?.questions?.[0]?.answer).toBe('Yes, push now')
  })

  it('falls back to the raw tool_result text when the answer cannot be parsed', () => {
    const raw = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: 'Pick an option.' },
        timestamp: '2026-01-01T10:00:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-askq-fallback'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_ask2',
              name: 'AskUserQuestion',
              input: {
                questions: [
                  {
                    question: 'Deploy to staging?',
                    header: 'Deploy',
                    options: [
                      { label: 'Yes', description: 'Deploy now.' },
                      { label: 'No', description: 'Hold off.' }
                    ],
                    multiSelect: false
                  }
                ]
              }
            }
          ]
        },
        timestamp: '2026-01-01T10:00:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-askq-fallback'
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u2',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_ask2',
              content:
                'User dismissed the question without a structured answer.'
            }
          ]
        },
        timestamp: '2026-01-01T10:00:06.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-askq-fallback'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.claude/projects/-tmp-repo-claude/session-claude-askq-fallback.jsonl',
      repoRoot: '/tmp/repo-claude',
      source: 'claude'
    })

    const askMessage = parsed[0].messages.find(
      message => message.questions && message.questions.length > 0
    )
    expect(askMessage?.questions?.[0]?.answer).toBe(
      'User dismissed the question without a structured answer.'
    )
  })

  it('aggregates per-message usage into a claude-messages token usage summary', () => {
    const raw = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: 'Investigate the regression.' },
        timestamp: '2026-01-01T10:00:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-usage'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: {
          id: 'msg-api-1',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'Looking into it.' }],
          usage: {
            input_tokens: 100,
            cache_read_input_tokens: 500,
            cache_creation_input_tokens: 300,
            cache_creation: {
              ephemeral_5m_input_tokens: 50,
              ephemeral_1h_input_tokens: 250
            },
            output_tokens: 80
          }
        },
        timestamp: '2026-01-01T10:00:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-usage'
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u2',
        message: { role: 'user', content: 'Keep going.' },
        timestamp: '2026-01-01T10:01:00.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-usage'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a2',
        message: {
          id: 'msg-api-2',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'Found the bug.' }],
          usage: {
            input_tokens: 20,
            cache_read_input_tokens: 700,
            cache_creation_input_tokens: 100,
            cache_creation: {
              ephemeral_5m_input_tokens: 0,
              ephemeral_1h_input_tokens: 100
            },
            output_tokens: 4
          }
        },
        timestamp: '2026-01-01T10:01:05.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-usage'
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a2-parallel',
        parentUuid: 'u2',
        message: {
          id: 'msg-api-2',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'Parallel tool result.' }],
          usage: {
            input_tokens: 20,
            cache_read_input_tokens: 700,
            cache_creation: {
              ephemeral_5m_input_tokens: 0,
              ephemeral_1h_input_tokens: 100
            },
            output_tokens: 40
          }
        },
        timestamp: '2026-01-01T10:01:06.000Z',
        cwd: '/tmp/repo-claude',
        sessionId: 'session-claude-usage'
      })
    ].join('\n')

    const parsed = parseSessionArtifacts(raw, {
      filePath:
        '/Users/me/.claude/projects/-tmp-repo-claude/session-claude-usage.jsonl',
      repoRoot: '/tmp/repo-claude',
      source: 'claude'
    })

    const usage = parsed[0].session.tokenUsage
    expect(usage?.source).toBe('claude-messages')
    expect(usage?.byModel).toHaveLength(1)
    expect(usage?.byModel[0]).toMatchObject({
      modelId: 'claude-sonnet-4-6',
      inputTokens: 120,
      cachedInputTokens: 1200,
      cacheWriteTokens: 50,
      cacheWrite1hTokens: 350,
      outputTokens: 120,
      reasoningTokens: 0
    })
    expect(usage?.totals).toMatchObject({
      inputTokens: 120,
      cachedInputTokens: 1200,
      cacheWriteTokens: 50,
      cacheWrite1hTokens: 350,
      outputTokens: 120,
      reasoningTokens: 0
    })
    expect(parsed[0].session.claudeUsageEvents).toHaveLength(2)
  })
})
