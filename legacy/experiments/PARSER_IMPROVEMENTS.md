# SvatahParserV2 - Parser Improvements

## Overview

This document describes the improvements made to the SvatahParserV2 parser system, including the new natural language parsing capabilities, hybrid parsing approach, and migration tools.

## Key Improvements

### 1. Natural Language Parser (`NaturalLanguageParser.java`)

The new `NaturalLanguageParser` class enables writing test steps in pure natural language without requiring special delimiters.

#### Old Format (with delimiters):
```
[+click+] [+id:loginButton+]
[+type+] [+id:username+] [*admin@example.com*]
[+verify+] [+text:Welcome+]
```

#### New Format (natural language):
```
Click the login button
Type admin@example.com into the username field
Verify the Welcome message appears
```

#### Supported Natural Language Patterns:

**Click Actions:**
- `Click the login button`
- `Click the submit button with id:submitBtn`
- `Click the link that says "Learn More"`

**Type/Enter Actions:**
- `Type admin@example.com into the username field`
- `Enter password123 into the password field with id:password`
- `Fill the email input with test@example.com`

**Verify Actions:**
- `Verify the welcome message appears`
- `Check that the error message is displayed`
- `Assert that the success notification is visible`

**Navigation Actions:**
- `Navigate to https://example.com`
- `Go to the login page`
- `Open the dashboard`

**Wait Actions:**
- `Wait for 5 seconds`
- `Wait for the loading spinner to disappear`

### 2. Hybrid Step Parser (`HybridStepParser.java`)

The `HybridStepParser` combines the speed of regex-based parsing with the intelligence of transformer-based parsing.

#### How It Works:

1. **Fast Path (Regex-based):** Simple, well-structured steps are parsed quickly using regex patterns.
2. **Fallback Path (Transformer-based):** Complex or ambiguous steps are parsed using transformer models.

#### Confidence Scoring:

Each parsed step includes a confidence score:
- **High confidence (>0.8):** Regex parser with clear patterns
- **Medium confidence (0.5-0.8):** Regex parser with some ambiguity
- **Low confidence (<0.5):** Transformer parser or ambiguous regex match

#### Configuration:

```java
// Create hybrid parser with transformer enabled
HybridStepParser parser = new HybridStepParser(config, true);

// Set confidence threshold
parser.setConfidenceThreshold(0.7);
```

### 3. Syntax Migration Tool (`SyntaxMigrationTool.java`)

The `SyntaxMigrationTool` helps migrate existing flow files from the old delimiter-based format to the new natural language format.

#### Usage:

```bash
# Migrate files from one directory to another
java SyntaxMigrationTool migrate ./flows ./migrated-flows

# Migrate files in place (creates backups)
java SyntaxMigrationTool in-place ./flows

# Convert a single file (prints to stdout)
java SyntaxMigrationTool convert ./flows/example.flow
```

#### Example Migration:

**Old Format:**
```
[+type+] [+id:username+] [*admin@example.com*]
[+click+] [+id:loginButton+]
[+verify+] [+text:Welcome+]
```

**New Format:**
```
Type admin@example.com into the username field
Click the login button
Verify the Welcome message appears
```

## Architecture

### Parser Hierarchy

```
SvatahParserV2
├── NaturalLanguageParser (primary)
│   ├── Pattern-based extraction
│   ├── Action dictionary lookup
│   └── Optional transformer fallback
├── HybridStepParser (alternative)
│   ├── DeterministicStepParser (fast path)
│   └── TransformerStepParser (fallback)
└── DeterministicStepParser (legacy)
    └── Regex-based parsing
```

### Key Components

| Component | Purpose |
|-----------|---------|
| `NaturalLanguageParser` | Primary parser for natural language steps |
| `HybridStepParser` | Combines regex and transformer parsing |
| `DeterministicStepParser` | Legacy regex-based parser |
| `TransformerStepParser` | Transformer-based NLP parser |
| `CoreNLPEntityExtractor` | Stanford CoreNLP for entity extraction |
| `JavaBERTActionClassifier` | BERT-based action classification |
| `SyntaxMigrationTool` | Migration utility for old format files |

## Usage Examples

### Basic Usage

```java
Config config = new Config();
NaturalLanguageParser parser = new NaturalLanguageParser(config);

// Load all scenario files
parser.loadScenarios(projectId);

// Or load specific files
List<File> files = Arrays.asList(new File("flows/login.flow"));
parser.loadScenarios(projectId, files);
```

### Hybrid Parser Usage

```java
Config config = new Config();
HybridStepParser parser = new HybridStepParser(config, true);

// Set confidence threshold
parser.setConfidenceThreshold(0.7);

// Load scenarios
parser.loadScenarios(projectId);
```

### Migration Usage

```java
// Migrate directory
SyntaxMigrationTool.migrateDirectory("./old-flows", "./new-flows");

// Migrate in place
SyntaxMigrationTool.migrateInPlace("./flows");
```

## Supported Locators

The parser supports all standard locator types:

| Locator Type | Example |
|--------------|---------|
| id | `id:username` |
| name | `name:email` |
| xpath | `xpath://div[@class='login']` |
| css | `css:.submit-button` |
| class | `class:alert` |
| tag | `tag:button` |
| link | `link:Click here` |
| partialLink | `partialLink:More` |
| text | `text:Welcome` |
| value | `value:submit` |
| accessibility | `accessibility:Close button` |

## Action Dictionary

The parser uses an action dictionary to map natural language actions to executable actions:

| Action | Description |
|--------|-------------|
| click | Click an element |
| type | Type text into a field |
| enter | Enter text into a field |
| verify | Verify an element exists |
| assert | Assert an element exists |
| check | Check an element exists |
| navigate | Navigate to a URL |
| wait | Wait for a condition |
| hover | Hover over an element |
| select | Select an option |

## Best Practices

### 1. Use Clear, Descriptive Step Names

**Good:**
```
Click the login button
Type admin@example.com into the username field
Verify the welcome message appears
```

**Avoid:**
```
Click button
Type text
Verify message
```

### 2. Include Locator Information When Needed

**Good:**
```
Click the submit button with id:submitBtn
Type password into the field with name:password
```

**Avoid:**
```
Click submit
Type password
```

### 3. Use Consistent Verb Tense

**Good:**
```
Click the button
Type the text
Verify the result
```

**Avoid:**
```
Clicked the button
Typing the text
Verify the result
```

### 4. Leverage the Migration Tool

For existing test suites, use the migration tool to convert old format files:

```bash
java SyntaxMigrationTool in-place ./flows
```

## Troubleshooting

### Parser Cannot Determine Action

If you see an error like "Could not determine action from step", try:
1. Using a more explicit action name (e.g., "Click" instead of "Press")
2. Adding locator information
3. Using the hybrid parser for complex sentences

### Low Confidence Scores

If you see low confidence scores:
1. Simplify the sentence structure
2. Use standard action names from the action dictionary
3. Enable transformer fallback for better accuracy

### Migration Issues

If migration produces unexpected results:
1. Review the generated files manually
2. Use the `convert` command to preview changes
3. Keep backup files (.backup extension)

## Future Enhancements

The following enhancements are planned:

1. **Improved Action Recognition:** Expand the action dictionary with more synonyms
2. **Context-Aware Parsing:** Use context from previous steps to improve accuracy
3. **Multi-language Support:** Add support for non-English test steps
4. **Visual Feedback:** Add confidence score visualization in test reports
5. **Learning Mode:** Allow the parser to learn from user corrections

## Contributing

To contribute to the parser improvements:

1. Add new action synonyms to the action dictionary
2. Improve regex patterns for better pattern matching
3. Add support for new locator types
4. Enhance the migration tool with more sophisticated transformations

## License

This project is part of the Svatah automation framework.