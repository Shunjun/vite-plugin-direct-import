// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    ignores: [
      'test/*/**/index.ts',
      // eslint ignore globs here
    ],
  },
  {
    rules: {
      // overrides
    },
  },
)
