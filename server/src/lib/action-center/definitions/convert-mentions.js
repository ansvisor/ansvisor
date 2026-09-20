/**
 * Growth — the brand is named in answers but not linked from them.
 *
 * A mention without a citation is recognition the brand earns nothing from:
 * the reader has no route back. The work is making the claim citable, not
 * winning more answers.
 */
export default {
  id: 'convert_mentions',
  version: 1,
  category: 'growth',
  signalKinds: ['uncited_mentions'],
  requires: ['tracking'],
  optional: [],
  tasks: ['identify_prompts', 'create_citable_content', 'strengthen_sources'],

  payload(byKind) {
    const mentions = (byKind.get('uncited_mentions') ?? [])[0];
    return { promptCount: Number(mentions?.current_value ?? 0) };
  },
};
