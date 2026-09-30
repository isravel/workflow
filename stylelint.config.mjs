const config = {
  extends: ["stylelint-config-standard-scss"],
  rules: {
    "selector-class-pattern": null,
    "declaration-empty-line-before": null,
    "scss/dollar-variable-empty-line-before": null,
    "color-hex-length": null,
    "color-function-notation": null,
    "color-function-alias-notation": null,
    "alpha-value-notation": null,
    "property-no-unknown": [true, { ignoreProperties: ["-webkit-tap-highlight-color"] }],
  },
};

export default config;