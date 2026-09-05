# Frozen parser experiments

These files were uncommitted work-in-progress in the Java project when the Draft 2
specification re-baselined Svatah as a TypeScript deterministic automation runtime
(HLD ADR-2). They are kept here for reference only.

They are **not** part of any source set: `legacy/build.gradle` compiles `legacy/src`
only, so nothing here is compiled and none of its dependencies are declared.

Because of that, the NLP dependencies these files experimented with
(`edu.stanford.nlp:stanford-corenlp` and its `models` / `models-english` classifiers,
`com.microsoft.onnxruntime:onnxruntime`, and `com.google.guava:guava`) are unreferenced
by the frozen project and are absent from `legacy/build.gradle` (T0.1).

Contents:

| File | What it was |
|---|---|
| `PARSER_IMPROVEMENTS.md` | Design notes for the abandoned parser rework |
| `StepParser.java` | Interface the experimental parsers implemented |
| `DeterministicStepParser.java` | Rule-based parser; superseded by the Tier 1 PEG grammar (LLD §4.2) |
| `NaturalLanguageParser.java` | Entry point combining the parsers |
| `HybridStepParser.java` | Deterministic-then-model cascade; superseded by the compiler tiers (HLD ADR-4) |
| `CoreNLPEntityExtractor.java` | Stanford CoreNLP NER/POS entity extraction |
| `JavaBERTActionClassifier.java` | ONNX-hosted action classifier; superseded by Tier 2 (LLD §10) |
| `TransformerStepParser.java` | Transformer-backed parser |
| `SyntaxMigrationTool.java` | v1/v2 rewriting; superseded by `svatah migrate` (T2.9) |
