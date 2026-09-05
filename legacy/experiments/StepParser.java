package com.svatah.automator.parser;

import com.svatah.automator.containers.*;
import com.svatah.automator.exceptions.InvalidFormatException;
import com.svatah.automator.core.Config;
import com.svatah.automator.exceptions.ProjectAlreadyRegisteredException;
import com.svatah.automator.exceptions.ScenarioParseException;
import com.svatah.automator.mappers.*;
import com.svatah.automator.mappers.ActionSynonyms;
import com.svatah.automator.utils.FileFinder;
import com.svatah.automator.utils.FileUtil;
import org.apache.logging.log4j.LogManager;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Simplified flow file parser with unified parsing logic.
 * Supports parsing scenarios, stories, tests, and compose sections from .flow files.
 */
public class StepParser {

    private static final org.apache.logging.log4j.Logger logger = LogManager.getLogger(StepParser.class);
    
    private static final Map<String, Pattern> PATTERN_CACHE = new ConcurrentHashMap<>();
    
    private final Config config;
    private Map<String, ApiRequest> apiCallsMap = Collections.emptyMap();

    public StepParser(Config config) {
        this.config = config;
        new ActionSynonyms(config.getBuildType());
    }

    /**
     * Load all scenario files from the flows root path.
     */
    public void loadScenarios(Long id) throws IOException {
        Path startingDir = Paths.get(config.getFlowsRootPath());
        logger.info("Starting Dir : " + startingDir);
        FileFinder.Finder finder = new FileFinder.Finder("*.flow");
        Files.walkFileTree(startingDir, finder);
        for (Path path : finder.getPathList()) {
            parseFile(id, path.toFile());
        }
    }

    /**
     * Load specific scenario files.
     */
    public void loadScenarios(Long id, List<File> scenarioFiles) throws IOException {
        for (File file : scenarioFiles) {
            parseFile(id, file);
        }
    }

    /**
     * Validate scenario files and return list of errors.
     */
    public List<FlowValidationErrorDetails> validate(Long id, List<File> scenarioFiles) {
        List<FlowValidationErrorDetails> errors = new ArrayList<>();
        ProjectOverview projectOverview = getOrCreateProjectOverview(id, errors);
        projectOverview.setApiCallsMap(apiCallsMap);

        for (File scenarioFile : scenarioFiles) {
            try {
                validateFile(scenarioFile, projectOverview, errors);
            } catch (IOException e) {
                errors.add(new FlowValidationErrorDetails(
                    scenarioFile.getName(), null, -1, null,
                    ParseExceptionType.FILE_READ_ISSUE, e.getMessage()
                ));
            }
        }
        return errors;
    }

    /**
     * Parse a single flow file in execution mode.
     */
    private void parseFile(Long id, File scenarioFile) throws IOException {
        ProjectOverview projectOverview = getOrCreateProjectOverview(id, null);
        projectOverview.setApiCallsMap(apiCallsMap);
        parseFileInternal(id, scenarioFile, projectOverview, false);
    }

    /**
     * Validate a single flow file.
     */
    private void validateFile(File scenarioFile, ProjectOverview projectOverview, List<FlowValidationErrorDetails> errors) throws IOException {
        parseFileInternal(0L, scenarioFile, projectOverview, true);
    }

    /**
     * Internal parser supporting both execution and validation modes.
     */
    private void parseFileInternal(Long id, File scenarioFile, ProjectOverview projectOverview, boolean validationMode) throws IOException {
        String flowFileName = scenarioFile.getName();
        List<FlowValidationErrorDetails> errorCollector = validationMode ? new ArrayList<>() : null;

        try (BufferedReader reader = new BufferedReader(new FileReader(scenarioFile))) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = skipCommentsAndEmptyLines(line, reader);
                if (line == null) break;

                if (isScenarioDeclaration(line)) {
                    parseScenarioDeclaration(id, scenarioFile, validationMode, projectOverview, 
                                           flowFileName, reader, line, errorCollector);
                } else if (!validationMode) {
                    throw new ScenarioParseException(
                        formatError(line, "flows should start with scenario/story/test/compose"),
                        new FlowValidationErrorDetails(flowFileName, null, -1, line,
                            ParseExceptionType.SYNTAX_ISSUE, line, "Invalid flow format")
                    );
                } else {
                    errorCollector.add(new FlowValidationErrorDetails(flowFileName, null, -1, line,
                        ParseExceptionType.SYNTAX_ISSUE, line, "Invalid flow format"));
                }
            }
        }
    }

    /**
     * Skip comment lines and empty lines.
     */
    private String skipCommentsAndEmptyLines(String line, BufferedReader reader) throws IOException {
        while (line != null && (line.startsWith("//") || line.trim().isEmpty())) {
            line = reader.readLine();
        }
        return line;
    }

    /**
     * Check if line is a scenario declaration.
     */
    private boolean isScenarioDeclaration(String line) {
        String lower = line.toLowerCase().trim();
        return lower.startsWith("scenario") || lower.startsWith("story") || 
               lower.startsWith("test") || lower.startsWith("compose");
    }

    /**
     * Get or create project overview.
     */
    private ProjectOverview getOrCreateProjectOverview(Long id, List<FlowValidationErrorDetails> errors) {
        try {
            logger.info("registering project with id : " + id);
            return ThreadedDataHandler.getInstance().registerProjectOverview(id, config);
        } catch (ProjectAlreadyRegisteredException e) {
            logger.info("scenario already registered with this id : " + e.getMessage());
            return ThreadedDataHandler.getInstance().getProjectOverview(id);
        }
    }

    /**
     * Parse scenario declaration line.
     */
    private void parseScenarioDeclaration(Long id, File scenarioFile, boolean validationMode,
                                         ProjectOverview projectOverview, String flowFileName,
                                         BufferedReader reader, String line, List<FlowValidationErrorDetails> errors) throws IOException {
        
        String[] typeInfoLine = line.split(":");
        if (typeInfoLine.length != 2) {
            addError(validationMode, errors, flowFileName, null, -1, line,
                ParseExceptionType.SYNTAX_ISSUE, "type and typeNameTag should be stored as 'type:typeNameTag'");
            return;
        }

        String type = extractType(typeInfoLine[0]);
        String typeNameTag = typeInfoLine[1].trim().replaceAll(" +", " ");
        String methodCallMetaData = extractMetaData(typeInfoLine[0]);
        
        ScenarioConfigMapper scenarioConfig = parseScenarioConfig(type, typeNameTag, methodCallMetaData, 
                                                                  flowFileName, validationMode, errors);
        if (scenarioConfig == null) return;

        if (isUniqueType(type) && projectOverview.getScenariosDetails().containsKey(typeNameTag)) {
            addError(validationMode, errors, flowFileName, typeNameTag, -1, line,
                ParseExceptionType.NAME_NOT_UNIQUE, "Scenario name must be unique");
            return;
        }

        List<String> steps = new ArrayList<>();
        List<ExecutableStep<ActionMapper>> stepList = new ArrayList<>();
        int stepNumber = 0;

        while ((line = reader.readLine()) != null && !line.trim().isEmpty()) {
            stepNumber++;
            if (line.trim().startsWith("//")) {
                steps.add(line);
                continue;
            }
            steps.add(line);

            if (type.equalsIgnoreCase("scenario") || type.equalsIgnoreCase("story")) {
                parseStep(flowFileName, typeNameTag, stepNumber, validationMode, line, stepList, errors);
            } else if (type.equalsIgnoreCase("test")) {
                projectOverview.addExecutionEntry(type, flowFileName, typeNameTag);
                return;
            } else if (type.equalsIgnoreCase("compose")) {
                parseComposeSection(reader, typeNameTag, projectOverview, flowFileName, validationMode, errors);
                return;
            } else {
                addError(validationMode, errors, flowFileName, typeNameTag, -1, line,
                    ParseExceptionType.SYNTAX_ISSUE, "'" + type + "' type is not supported");
                return;
            }
        }

        projectOverview.addScenarioEntry(type, flowFileName, typeNameTag, 
            new ScenarioDetails<>(scenarioConfig, steps, stepList));
    }

    /**
     * Parse scenario configuration parameters.
     */
    private ScenarioConfigMapper parseScenarioConfig(String type, String typeNameTag, String methodCallMetaData,
                                                     String flowFileName, boolean validationMode, List<FlowValidationErrorDetails> errors) {
        ScenarioConfigMapper config = new ScenarioConfigMapper();
        
        if (methodCallMetaData != null) {
            logger.info("Additional param mapping found for " + type + " : " + typeNameTag);
            String[] kvPairs = methodCallMetaData.replaceAll("\\s", "").split(",");
            Map<String, String> params = new HashMap<>();
            
            for (String kvPair : kvPairs) {
                String[] kv = kvPair.split("=");
                if (kv.length != 2) {
                    addError(validationMode, errors, flowFileName, null, -1, null,
                        ParseExceptionType.SYNTAX_ISSUE, "Params must be in format key=value");
                    return null;
                }
                params.put(kv[0].toLowerCase(), kv[1].toLowerCase());
            }
            
            if ("false".equalsIgnoreCase(params.get("enabled"))) {
                logger.info("Skipping disabled scenario : " + typeNameTag);
                return null;
            }
            
            config.setDataProvider(params.get("data_provider"));
            config.setFilePath(params.get("file_path"));
        } else {
            logger.info("Using default configuration for scenario : " + typeNameTag);
        }
        return config;
    }

    /**
     * Parse a single step line.
     */
    private void parseStep(String flowFileName, String scenarioName, int stepNumber, boolean validationMode,
                          String line, List<ExecutableStep<ActionMapper>> stepList, List<FlowValidationErrorDetails> errors) {
        String actionName = extractData("\\+(.+?)\\+", line);
        
        if (actionName == null || actionName.isEmpty()) {
            addError(validationMode, errors, flowFileName, scenarioName, stepNumber, line,
                ParseExceptionType.INTENT_MAPPING_ISSUE, "Define intent as : +intent+");
            return;
        }

        ActionMapper<?> action = ActionDictionaryMapper.getInstance().getAction(actionName);
        Class<?> actionClass = ActionDictionaryMapper.getInstance().getActionClass(action);
        
        if (actionClass == null) {
            addError(validationMode, errors, flowFileName, scenarioName, stepNumber, line,
                ParseExceptionType.INTENT_MAPPING_ISSUE, "Unknown intent : " + actionName);
            return;
        }

        StepData stepData = createStepData(actionClass);
        Input input = createStepInput(actionClass);
        Output output = createStepOutput(actionClass);
        
        parseStepData(actionName, actionClass, stepData, input, output, line, 
                     flowFileName, scenarioName, stepNumber, validationMode, errors);
        
        if (action != null) {
            stepData.setInputData(input);
            stepData.setOutputData(output);
            stepList.add(new ExecutableStep<>(actionName, action, stepData, getStepVariable(output)));
        }
    }

    /**
     * Parse step data including input, locator, and output.
     */
    private void parseStepData(String actionName, Class<?> actionClass, StepData stepData, Input input,
                              Output output, String line, String flowFileName, String scenarioName,
                              int stepNumber, boolean validationMode, List<FlowValidationErrorDetails> errors) {
        // Parse input data
        String dataSet = extractData("\\*(.+?)\\*", line);
        if (dataSet != null) {
            try {
                input.setInputDataList(FileUtil.commaSplitter(dataSet));
            } catch (InvalidFormatException e) {
                addError(validationMode, errors, flowFileName, scenarioName, stepNumber, line,
                    ParseExceptionType.SYNTAX_ISSUE, "Invalid data format: " + e.getMessage());
            }
        } else {
            input.setInputDataList(Collections.emptyList());
        }

        // Parse locator if required
        boolean locatorRequired = !HttpActionMapper.class.equals(actionClass) &&
            !LocatorNotRequiredMapper.getActionsWithoutLocatorsSet().contains(
                ActionDictionaryMapper.getInstance().getAction(actionName));

        if (locatorRequired) {
            parseLocator(input, actionName, line, flowFileName, scenarioName, stepNumber, 
                        validationMode, errors);
        } else if (HttpActionMapper.class.equals(actionClass)) {
            parseApiReference(input, line, flowFileName, scenarioName, stepNumber, 
                             validationMode, errors);
        }

        // Parse output variable
        parseOutputVariable(output, line, flowFileName, scenarioName, stepNumber, 
                           validationMode, errors);
    }

    /**
     * Parse locator information from step line.
     */
    private void parseLocator(Input input, String actionName, String line, String flowFileName,
                             String scenarioName, int stepNumber, boolean validationMode,
                             List<FlowValidationErrorDetails> errors) {
        String identityInfo = extractData("~(.+?)~", line);
        List<String> locatorList = parseLocatorList(identityInfo);
        
        if (locatorList.isEmpty() || identityInfo == null) {
            addError(validationMode, errors, flowFileName, scenarioName, stepNumber, line,
                ParseExceptionType.IDENTITY_MAPPING_ISSUE, "Define locator for : " + actionName);
            return;
        }
        
        LocatorMap locatorMap = new LocatorMap();
        for (String locatorDetails : locatorList) {
            String[] kv = parseLocatorKeyValue(locatorDetails, flowFileName, scenarioName, stepNumber, line, validationMode, errors);
            if (kv != null) {
                locatorMap.addTypeAndLocator(LocatorType.getLocatorType(kv[0].trim()), kv[1].trim());
            }
        }
        input.set(locatorMap);
    }

    /**
     * Parse API reference for HTTP actions.
     */
    private void parseApiReference(Input input, String line, String flowFileName,
                                   String scenarioName, int stepNumber, boolean validationMode,
                                   List<FlowValidationErrorDetails> errors) {
        String identityInfo = extractData("~(.+?)~", line);
        ApiRequest apiRequest = ThreadedDataHandler.getInstance()
            .getProjectOverview(0L).getApiCallsMap().get(identityInfo);
        
        if (apiRequest == null) {
            addError(validationMode, errors, flowFileName, scenarioName, stepNumber, line,
                ParseExceptionType.API_CALL_NOT_FOUND, "API not found : " + identityInfo);
            return;
        }
        input.set(apiRequest);
    }

    /**
     * Parse output variable from step line.
     */
    private void parseOutputVariable(Output output, String line, String flowFileName,
                                    String scenarioName, int stepNumber, boolean validationMode,
                                    List<FlowValidationErrorDetails> errors) {
        String stepVariable = extractData("var\\s*:\\s*(\\S+)", line);
        if (stepVariable == null) {
            String[] arr = extractData("var\\s*[(](.+?)[)]\\s*:\\s*(\\S+)", line, new int[]{1, 2});
            if (arr != null && arr.length >= 1) {
                output.set(arr[0]);
            }
        }
    }

    /**
     * Parse compose section (legacy - consumes lines without processing).
     */
    private void parseComposeSection(BufferedReader reader, String typeNameTag, 
                                    ProjectOverview projectOverview, String flowFileName,
                                    boolean validationMode, List<FlowValidationErrorDetails> errors) throws IOException {
        String line;
        while ((line = reader.readLine()) != null && !line.trim().isEmpty()) {
            // Consume compose lines - legacy code
        }
    }

    /**
     * Parse locator list from identity info.
     */
    private List<String> parseLocatorList(String identityInfo) {
        if (identityInfo == null) return Collections.emptyList();
        
        identityInfo = identityInfo.trim();
        if (identityInfo.contains(":")) {
            return Arrays.asList(identityInfo.split("\\s*&&\\s*"));
        }
        
        if (config.getLocatorMapping().containsKey(identityInfo)) {
            String value = config.getLocatorMapping().get(identityInfo);
            return Arrays.asList(value.split("\\s*&&\\s*"));
        }
        return Collections.emptyList();
    }

    /**
     * Parse locator key-value pair.
     */
    private String[] parseLocatorKeyValue(String locatorDetails, String flowFileName,
                                         String scenarioName, int stepNumber, String line,
                                         boolean validationMode, List<FlowValidationErrorDetails> errors) {
        try {
            int colonIndex = locatorDetails.indexOf(":");
            if (colonIndex == -1) {
                addError(validationMode, errors, flowFileName, scenarioName, stepNumber, line,
                    ParseExceptionType.IDENTITY_MAPPING_ISSUE, "Invalid locator format : " + locatorDetails);
                return null;
            }
            String[] kv = new String[2];
            kv[0] = locatorDetails.substring(0, colonIndex);
            kv[1] = locatorDetails.substring(colonIndex + 1);
            logger.info("locatorType : " + kv[0] + ", locator : " + kv[1]);
            return kv;
        } catch (Exception e) {
            addError(validationMode, errors, flowFileName, scenarioName, stepNumber, line,
                ParseExceptionType.IDENTITY_MAPPING_ISSUE, "Error parsing locator : " + locatorDetails);
            return null;
        }
    }

    /**
     * Extract type from declaration line (removes parentheses and metadata).
     */
    private String extractType(String typeInfoLine) {
        return typeInfoLine.trim().split("\\(")[0].toLowerCase();
    }

    /**
     * Check if type requires unique names.
     */
    private boolean isUniqueType(String type) {
        return type.equalsIgnoreCase("scenario") || type.equalsIgnoreCase("story");
    }

    /**
     * Extract metadata from parentheses.
     */
    private String extractMetaData(String metaData) {
        Pattern pattern = getPattern("\\((.+?)\\)");
        Matcher matcher = pattern.matcher(metaData);
        return matcher.find() ? matcher.group(1) : null;
    }

    /**
     * Extract data using regex pattern.
     */
    private String extractData(String patternString, String data) {
        Pattern pattern = getPattern(patternString);
        Matcher matcher = pattern.matcher(data);
        return matcher.find() ? matcher.group(1) : null;
    }

    /**
     * Extract multiple groups using regex pattern.
     */
    private String[] extractData(String patternString, String data, int[] groups) {
        Pattern pattern = getPattern(patternString);
        Matcher matcher = pattern.matcher(data);
        if (!matcher.find()) return null;
        
        String[] result = new String[groups.length];
        for (int i = 0; i < groups.length; i++) {
            result[i] = matcher.group(groups[i]);
        }
        return result;
    }

    /**
     * Get or cache regex pattern.
     */
    private Pattern getPattern(String patternString) {
        return PATTERN_CACHE.computeIfAbsent(patternString, Pattern::compile);
    }

    /**
     * Create appropriate StepData instance based on action class.
     */
    private StepData createStepData(Class<?> actionClass) {
        if (actionClass.equals(SeleniumActionMapper.class)) {
            return new SeleniumStepData();
        } else if (actionClass.equals(MobileActionMapper.class)) {
            return new MobileStepData();
        } else if (actionClass.equals(HttpActionMapper.class)) {
            return new ApiStepData();
        }
        return new SeleniumStepData();
    }

    /**
     * Create appropriate Input instance based on action class.
     */
    private Input createStepInput(Class<?> actionClass) {
        if (actionClass.equals(HttpActionMapper.class)) {
            return new ApiInput();
        }
        return new SeleniumInput();
    }

    /**
     * Create appropriate Output instance based on action class.
     */
    private Output createStepOutput(Class<?> actionClass) {
        if (actionClass.equals(HttpActionMapper.class)) {
            return new ApiOutput();
        }
        return new SeleniumOutput();
    }

    /**
     * Get step variable from output.
     */
    private String getStepVariable(Output<?> output) {
        return output != null ? (String) output.get() : null;
    }

    /**
     * Add error to collector or throw exception.
     */
    private void addError(boolean validationMode, List<FlowValidationErrorDetails> errors,
                         String flowFileName, String scenarioName, int stepNumber, String line,
                         ParseExceptionType type, String message) {
        if (validationMode) {
            errors.add(new FlowValidationErrorDetails(flowFileName, scenarioName, stepNumber, line, type, message));
        } else {
            throw new ScenarioParseException(
                formatError(line, message),
                new FlowValidationErrorDetails(flowFileName, scenarioName, stepNumber, line, type, message)
            );
        }
    }

    /**
     * Format error message with context.
     */
    private String formatError(String line, String message) {
        return "Format error: " + message + " at line: " + line;
    }

    /**
     * Get action mapper class name from line.
     */
    public String getActionMapperClass(String line) throws InstantiationException {
        String actionName = extractData("\\+(.+?)\\+", line);
        if (actionName == null) {
            throw new InstantiationException("Action not specified in line: " + line);
        }
        ActionMapper<?> action = ActionDictionaryMapper.getInstance().getAction(actionName);
        Class<?> actionClass = ActionDictionaryMapper.getInstance().getActionClass(action);
        return actionClass != null ? actionClass.getSimpleName() : null;
    }

    /**
     * Set API calls map for HTTP actions.
     */
    public void setApiCallsMap(Map<String, ApiRequest> apiCallsMap) {
        this.apiCallsMap = apiCallsMap;
    }
}