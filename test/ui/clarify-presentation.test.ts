import { describe, expect, it } from 'vitest';
import { TalqynAssistantTurn } from '../../src/consultant-core/index.js';
import { TalqynClarifyPresentation } from '../../src/ui/transcript/clarify-presentation.js';

function asking(): TalqynAssistantTurn {
  return {
    ...TalqynAssistantTurn.create('recommend something'),
    clarify: { message: 'clarify', questions: [{ id: 'budget', label: 'Budget?', multi: false, options: ['under 300k'] }] },
  };
}

describe('TalqynClarifyPresentation', () => {
  it('brings up one sheet per question the shopper typed', () => {
    const policy = new TalqynClarifyPresentation();
    policy.beginRequest();
    const first = asking();
    expect(policy.decide(first, true)).toBe('sheet');
    expect(policy.decide(first, true), 'a turn is decided once').toBe('none');

    const followUp = asking();
    expect(policy.decide(followUp, true), 'a second sheet in a row is an interrogation').toBe('inline');
    expect(policy.inlineTurns.has(followUp.id)).toBe(true);

    policy.beginRequest();
    expect(policy.decide(asking(), true), 'a new question gets its own').toBe('sheet');
  });

  it('keeps a question whose sheet cannot come up in the transcript', () => {
    const policy = new TalqynClarifyPresentation();
    policy.beginRequest();
    expect(policy.decide(asking(), false)).toBe('inline');
  });

  it('moves a dismissed sheet into the transcript, and forgets it with its turn', () => {
    const policy = new TalqynClarifyPresentation();
    policy.beginRequest();
    const turn = asking();
    policy.decide(turn, true);
    policy.sheetDismissed(turn.id);
    expect(policy.inlineTurns.has(turn.id)).toBe(true);
    policy.forget([turn.id]);
    expect(policy.inlineTurns.has(turn.id)).toBe(false);
  });

  it('has nothing to show for an answered question or a plain turn', () => {
    const policy = new TalqynClarifyPresentation();
    expect(policy.decide({ ...asking(), clarifyAnswer: 'Budget: under 300k.' }, true)).toBe('none');
    expect(policy.decide(TalqynAssistantTurn.create('q'), true)).toBe('none');
  });
});
