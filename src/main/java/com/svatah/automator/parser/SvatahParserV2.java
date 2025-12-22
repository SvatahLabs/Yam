package com.svatah.automator.parser;

import com.svatah.automator.containers.*;
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

/**
 * Created by AtulSharma on 21/02/18
 */
public class SvatahParserV2 {

    private static final org.apache.logging.log4j.Logger logger = LogManager.getLogger(SvatahParserV2.class);
    private Map<String, ApiRequest> apiCallsMap = Collections.emptyMap();
    private Config config;

    public SvatahParserV2(Config config) {
        this.config = config;
        new ActionSynonyms(config.getBuildType());
    }

    public void loadScenarios(Long id) throws IOException {
        Path startingDir = Paths.get(config.getFlowsRootPath());
        logger.info("Starting Dir : " + startingDir);
        String pattern = "*.flow";
        FileFinder.Finder finder = new FileFinder.Finder(pattern);
        Files.walkFileTree(startingDir, finder);
        for (Path path : finder.getPathList())
            flowFileParser(id, path.toFile());
    }

    public void loadScenarios(Long id, List<File> scenarioFiles) throws IOException {
        for (File file : scenarioFiles)
            flowFileParser(id, file);
    }

    private void flowFileParser(Long id, File scenarioFile) throws IOException {
        ProjectOverview projectOverview;
        try {
            logger.info("registering project with id : " + id);
            projectOverview = ThreadedDataHandler.getInstance().registerProjectOverview(id, config);
        } catch (ProjectAlreadyRegisteredException e) {
            logger.info("scenario already registered with this id  : " + e.getMessage());
            projectOverview = ThreadedDataHandler.getInstance().getProjectOverview(id);
        }
        projectOverview.setApiCallsMap(apiCallsMap);
        String flowFileName = scenarioFile.getName();

//        List<String> allLines = Files.readAllLines(Paths.get(scenarioFile.toURI()));
//        for (String line : allLines) {
//            System.out.println(line);
//        }

        try (BufferedReader bufferedScenarioFile = new BufferedReader(new FileReader(scenarioFile))) {
            String line;
            while ((line = bufferedScenarioFile.readLine()) != null) {
                //if line starts with "//", then it is treated as a comment line and ignored.
                while (line != null && (line.startsWith(ProjectKeywords.COMMENT_LINE.getKeyword()) || line.isEmpty())) {
                    line = bufferedScenarioFile.readLine();
                }
                if (line == null) {
                    break;
                }
                //Firstly the parser searches for Scenario Keyword to add a scenario to executor.
                if (line.toLowerCase().startsWith(ProjectKeywords.SCENARIO.getKeyword()) || line.toLowerCase().startsWith(ProjectKeywords.STORY.getKeyword()) || line.toLowerCase().startsWith(ProjectKeywords.TEST.getKeyword()) || line.toLowerCase().startsWith(ProjectKeywords.COMPOSE.getKeyword())) {
                    //parser needs to determine the type {scenario, story, test, compose}
                    /**/
                    /*extracting type and typeNameTag it is stored as type:typeNameTag*/
                    String[] typeInfoLine = line.split(":");
                    if (typeInfoLine.length != 2) {
                        logger.info(scenarioExceptionMessage(line));
                        throw new ScenarioParseException(scenarioExceptionMessage(line), new FlowValidationErrorDetails(flowFileName, null, -1, line, ParseExceptionType.SYNTAX_ISSUE, scenarioExceptionMessage(line), "type and typeNameTag should be stored as 'type:typeNameTag'"));
                    }
                    /**/
                    String type = typeInfoLine[0].trim().split("\\(")[0];
                    String typeNameTag = typeInfoLine[1].trim().replaceAll(" +", " ");
                    String methodCallMetaData = extractMetaData(typeInfoLine[0]);
                    ScenarioConfigMapper scenarioConfigMapper = new ScenarioConfigMapper();
                    if (methodCallMetaData != null) {
                        logger.info("Additional param mapping found for " + type + " : " + typeNameTag);
                        String[] methodConfKVPair = methodCallMetaData.replaceAll("\\s", "").split(",");
                        Map<String, String> params = new HashMap<>();
                        for (String kvPair : methodConfKVPair) {
                            String[] kv = kvPair.split("=");
                            if (kv.length != 2) {
                                throw new ScenarioParseException(scenarioExceptionMessage(line, "Scenario params must be in format > (key=value, k2=v2,..)"), new FlowValidationErrorDetails(flowFileName, null, -1, line, ParseExceptionType.SYNTAX_ISSUE, scenarioExceptionMessage(line), "Scenario params must be in format > (key=value, k2=v2,..)"));
                            }
                            params.put(kv[0].toLowerCase(), kv[1].toLowerCase());
                        }
                        if (params.get(ProjectKeywords.ENABLED.getKeyword()) != null && params.get(ProjectKeywords.ENABLED.getKeyword()).equalsIgnoreCase("false")) {
                            logger.info("Skipping the scenario : " + typeNameTag + ", as scenario is disabled.");
                            continue;
                        }
                        scenarioConfigMapper.setDataProvider(params.getOrDefault(ProjectKeywords.DATA_PROVIDER.getKeyword(), null));
                        scenarioConfigMapper.setFilePath(params.getOrDefault(ProjectKeywords.FILE_PATH.getKeyword(), null));
                    } else {
                        logger.info("No additional param mapping found. Hence will test scenario : " + typeNameTag + " using default configuration.");
                    }

                    /*for type=scenario, scenario names should be unique*/
                    if (type.equalsIgnoreCase(ProjectKeywords.SCENARIO.getKeyword()) || type.equalsIgnoreCase(ProjectKeywords.STORY.getKeyword())) {
                        if (projectOverview.getScenariosDetails().containsKey(typeNameTag)) {
                            logger.info("Skipping the scenario : " + line + ", as it contains duplicate scenario name.");
                            throw new ScenarioParseException(scenarioExceptionMessage("{ flow file : " + flowFileName + ", type : " + type + ", name: " + typeNameTag + ", step : " + line + "}", "Scenario name must be unique."), new FlowValidationErrorDetails(flowFileName, typeNameTag, -1, line, ParseExceptionType.NAME_NOT_UNIQUE, "{ flow file : " + flowFileName + ", type : " + type + ", name: " + typeNameTag + ", step : " + line + "}", "Scenario name must be unique."));
                        }
                    } else {
                        logger.info("Dependency mapping found. Will try to map the scenario: '" + typeNameTag + "' in the flow execution");
                    }
                    List<String> steps = new ArrayList<>();
                    List<ExecutableStep<ActionMapper>> stepList = new ArrayList<>();
                    int stepNumber;
                    if (type.equalsIgnoreCase(ProjectKeywords.SCENARIO.getKeyword()) || type.equalsIgnoreCase(ProjectKeywords.STORY.getKeyword())) {
                        stepNumber = 0;
                        /*The following loop evaluates the next lines as 'steps' for given 'type:scenario' until it encounters an 'empty' or 'null' line.*/
                        while ((line = bufferedScenarioFile.readLine()) != null && !line.isEmpty()) {
                            stepNumber++;
                            //if line starts with "//", then it is treated as a comment line and ignored.
                            if (line.startsWith(ProjectKeywords.COMMENT_LINE.getKeyword()))
                                continue;
                            steps.add(line);
                            StepData stepData;
                            Input input;
                            Output output;
                            //List<String> stepValues = extractData("[@](.*?)[\\s]|['](.*?)[']|[~](.*?)[~]", line);
                            String actionName = extractData("[+](.*?)[+]", line);
                            if (actionName == null || actionName.equals(""))
                                throw new ScenarioParseException("Did not find corresponding intent mapping for step : " + line, new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.INTENT_MAPPING_ISSUE, "Did you specify intent?", "define valid intent as : +intent+"));
                            ActionMapper<?> action = ActionDictionaryMapper.getInstance().getAction(actionName);
                            Class<?> classVar = ActionDictionaryMapper.getInstance().getActionClass(action);
                            if (classVar == null) {
                                throw new ScenarioParseException("Did not find corresponding action mapping for key : " + actionName, new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.INTENT_MAPPING_ISSUE, "Did not find corresponding intent mapping for key : " + actionName, "define valid intent as : +intent+"));
                            }
                            if (classVar.equals(SeleniumActionMapper.class)) {
                                stepData = new SeleniumStepData();
                                input = new SeleniumInput();
                                output = new SeleniumOutput();
                            } else if (classVar.equals(MobileActionMapper.class)) {
                                stepData = new MobileStepData();
                                input = new SeleniumInput();
                                output = new SeleniumOutput();
                            } else if (classVar.equals(HttpActionMapper.class)) {
                                stepData = new ApiStepData();
                                input = new ApiInput();
                                output = new ApiOutput();
                            } else {
                                stepData = new SeleniumStepData();
                                input = new SeleniumInput();
                                output = new SeleniumOutput();
                            }
                            if (action == null)
                                throw new ScenarioParseException("Did not find corresponding intent mapping for key : " + actionName, new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.INTENT_MAPPING_ISSUE, "Did not find corresponding intent mapping for key : " + actionName, "define valid intent as : +intent+"));
                            String dataSet = extractData("[*](.*?)[*]", line);
                            if (dataSet != null) {
                                //RULE : Input data set is a list of strings separated by comma
                                //RULE : Input data can be a variable.  If so, then it should start with a HASH
                                //RULE : Input data as variables from different story/scenario must start with a HASH followed by story/scenario name, then a dot and then the variable name
                                List<String> dataList = FileUtil.commaSplitter(dataSet);
                                input.setInputDataList(dataList);
                            } else {
                                input.setInputDataList(Collections.EMPTY_LIST);
                            }
                            boolean locatorRequired = classVar.equals(SeleniumActionMapper.class) ? !LocatorNotRequiredMapper.getActionsWithoutLocatorsSet().contains(action) : (!classVar.equals(MobileActionMapper.class) || !LocatorNotRequiredMapper.getMobileActionsWithoutLocatorsSet().contains(action));
                            //System.out.println("is locator required for "+ actionName +"? " + locatorRequired);
                            if (actionName != null && !classVar.equals(HttpActionMapper.class) && locatorRequired) {
                                String identityInfo = extractData("[~](.*?)[~]", line);
                                List<String> locatorList = Collections.emptyList();
                                if (identityInfo != null) {
                                    identityInfo = identityInfo.trim();
                                    if (identityInfo.contains(":"))
                                        locatorList = Arrays.asList(identityInfo.split(ProjectKeywords.AND.getKeyword()));
                                    else {
                                        if (config.getLocatorMapping().containsKey(identityInfo)) {
                                            String value = config.getLocatorMapping().get(identityInfo);
                                            locatorList = Arrays.asList(value.split(ProjectKeywords.AND.getKeyword()));
                                        } else {
                                            throw new ScenarioParseException(scenarioExceptionMessage(line) + " check > " + identityInfo + " for errors.", new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.IDENTITY_MAPPING_ISSUE, scenarioExceptionMessage(line), " check > locatorDetails : " + identityInfo + " for errors."));
                                        }
                                    }
                                } else {
                                    logger.error("locator not found, does this line require a locator? " + scenarioExceptionMessage(line));
                                    throw new ScenarioParseException(scenarioExceptionMessage(line), new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.IDENTITY_MAPPING_ISSUE, scenarioExceptionMessage(line), " please define identity (locator) for intent : " + actionName));
                                }
                                LocatorMap locatorMap = new LocatorMap();
                                for (String locatorDetails : locatorList) {
                                    String[] kv = new String[2];
                                    try {
                                        kv[0] = locatorDetails.substring(0, locatorDetails.indexOf(":"));
                                        kv[1] = locatorDetails.substring(locatorDetails.indexOf(":") + 1);
                                        logger.info("locatorType : " + kv[0] + ", locator : " + kv[1]);
                                    } catch (Exception e) {
                                        logger.info(scenarioExceptionMessage(line));
                                        throw new ScenarioParseException(scenarioExceptionMessage(line) + " check > " + locatorDetails + " for errors.", new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.IDENTITY_MAPPING_ISSUE, scenarioExceptionMessage(line), " check > locatorDetails : " + locatorDetails + " for errors."));
                                    }
                                    if (LocatorType.getLocatorType(kv[0].trim()) == null)
                                        throw new ScenarioParseException(scenarioExceptionMessage(line) + " check > " + locatorDetails + " for errors.", new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.IDENTITY_MAPPING_ISSUE, scenarioExceptionMessage(line), " This is not a valid locator type : " + kv[0].trim()));
                                    locatorMap.addTypeAndLocator(LocatorType.getLocatorType(kv[0].trim()), kv[1].trim());
                                }
                                input.set(locatorMap);
                            } else if (classVar.equals(HttpActionMapper.class)) {
                                String identityInfo = extractData("[~](.*?)[~]", line);
                                ApiRequest apiRequest = projectOverview.getApiCallsMap().get(identityInfo);
                                if (apiRequest == null)
                                    throw new ScenarioParseException(scenarioExceptionMessage(line) + " check > '" + identityInfo + "' for errors. There is no api call saved with this name.", new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.API_CALL_NOT_FOUND, scenarioExceptionMessage(line), " There is no api call saved with this name : " + identityInfo));
                                input.set(apiRequest);
                            }
                            String stepVariable = extractData("var\\s*:\\s*(\\S+)", line);
                            if (stepVariable == null) {
                                String arr[] = extractData("var\\s*[(](.*?)[)]\\s*:\\s*(\\S+)", line, new int[]{1, 2});
                                output.set(arr[0]);
                                stepVariable = arr[1];
                            }

                            if (actionName != null) {
                                stepData.setInputData(input);
                                stepData.setOutputData(output);
                                stepList.add(new ExecutableStep<>(actionName, action, stepData, stepVariable));
                            }
                        }
                        if (type.equalsIgnoreCase(ProjectKeywords.STORY.getKeyword()))
                            projectOverview.addStoryEntry(type, typeNameTag, new ScenarioDetails<>(scenarioConfigMapper, steps, stepList));
                        else
                            projectOverview.addScenarioEntry(type, flowFileName, typeNameTag, new ScenarioDetails<>(scenarioConfigMapper, steps, stepList));
                    } else if (type.equalsIgnoreCase(ProjectKeywords.TEST.getKeyword())) {
                        projectOverview.addExecutionEntry(type, flowFileName, typeNameTag);
                    } else if (type.equalsIgnoreCase(ProjectKeywords.COMPOSE.getKeyword())) {
                        stepNumber = 0;
                        while ((line = bufferedScenarioFile.readLine()) != null && !line.isEmpty()) {
                            stepNumber++;
                            //if line starts with "//", then it is treated as a comment line and ignored.
                            if (line.startsWith(ProjectKeywords.COMMENT_LINE.getKeyword()))
                                continue;
                            steps.add(line);
                            line = line.trim().replaceAll(" +", " ");
                            projectOverview.addCompositionEntry(typeNameTag, line);
                        }
                    } else {
                        logger.error(scenarioExceptionMessage(line, "'" + type + "' type not supported."));
                        throw new ScenarioParseException(scenarioExceptionMessage(line, "'" + type + "' type not supported."), new FlowValidationErrorDetails(flowFileName, typeNameTag, -1, line, ParseExceptionType.SYNTAX_ISSUE, scenarioExceptionMessage(line), "'" + type + "' type is currently not supported."));
                    }

                } else {
                    logger.info("waiting for a valid type:{scenario|story|test|compose} to get started...");
                    throw new ScenarioParseException(scenarioExceptionMessage(line), new FlowValidationErrorDetails(flowFileName, null, -1, line, ParseExceptionType.SYNTAX_ISSUE, scenarioExceptionMessage(line), "flows should be made up of valid types:{scenario|story|compose|test}."));
                }
            }
        }
    }

    public List<FlowValidationErrorDetails> validate(Long id, List<File> scenarioFiles) {
        List<FlowValidationErrorDetails> validationErrorDetailsList = new ArrayList<>();
        ProjectOverview projectOverview;
        try {
            logger.info("validating project with id : " + id);
            projectOverview = ThreadedDataHandler.getInstance().registerProjectOverview(id, config);
        } catch (ProjectAlreadyRegisteredException e) {
            logger.info("scenario already registered with this id  : " + e.getMessage());
            projectOverview = ThreadedDataHandler.getInstance().getProjectOverview(id);
        }
        projectOverview.setApiCallsMap(apiCallsMap);
        for (File scenarioFile : scenarioFiles) {
            try {
                String flowFileName = scenarioFile.getName();
                try (BufferedReader bufferedScenarioFile = new BufferedReader(new FileReader(scenarioFile))) {
                    String line;
                    while ((line = bufferedScenarioFile.readLine()) != null) {
                        //if line starts with "//", then it is treated as a comment line and ignored.
                        while (line != null && (line.startsWith(ProjectKeywords.COMMENT_LINE.getKeyword()) || line.isEmpty())) {
                            line = bufferedScenarioFile.readLine();
                        }
                        if (line == null) {
                            break;
                        }
                        //Firstly the parser searches for Scenario Keyword to add a scenario to executor.
                        if (line.toLowerCase().startsWith(ProjectKeywords.SCENARIO.getKeyword()) || line.toLowerCase().startsWith(ProjectKeywords.STORY.getKeyword()) || line.toLowerCase().startsWith(ProjectKeywords.TEST.getKeyword()) || line.toLowerCase().startsWith(ProjectKeywords.COMPOSE.getKeyword())) {
                            //parser needs to determine the type {scenario, story, test, compose}
                            /**/
                            /*extracting type and typeNameTag it is stored as type:typeNameTag*/
                            String[] typeInfoLine = line.split(":");
                            if (typeInfoLine.length != 2) {
                                logger.info(scenarioExceptionMessage(line));
                                validationErrorDetailsList.add(new FlowValidationErrorDetails(flowFileName, null, -1, line, ParseExceptionType.SYNTAX_ISSUE, scenarioExceptionMessage(line), "type and typeNameTag should be stored as 'type:typeNameTag'"));
                            }
                            /**/
                            String type = typeInfoLine[0].trim().split("\\(")[0];
                            String typeNameTag = typeInfoLine[1].trim().replaceAll(" +", " ");
                            String methodCallMetaData = extractMetaData(typeInfoLine[0]);
                            ScenarioConfigMapper scenarioConfigMapper = new ScenarioConfigMapper();
                            if (methodCallMetaData != null) {
                                logger.info("Additional param mapping found for " + type + " : " + typeNameTag);
                                String[] methodConfKVPair = methodCallMetaData.replaceAll("\\s", "").split(",");
                                Map<String, String> params = new HashMap<>();
                                for (String kvPair : methodConfKVPair) {
                                    String[] kv = kvPair.split("=");
                                    if (kv.length != 2) {
                                        validationErrorDetailsList.add(new FlowValidationErrorDetails(flowFileName, null, -1, line, ParseExceptionType.SYNTAX_ISSUE, scenarioExceptionMessage(line), "Scenario params must be in format > (key=value, k2=v2,..)"));
                                    }
                                    params.put(kv[0].toLowerCase(), kv[1].toLowerCase());
                                }
                                if (params.get(ProjectKeywords.ENABLED.getKeyword()) != null && params.get(ProjectKeywords.ENABLED.getKeyword()).equalsIgnoreCase("false")) {
                                    logger.info("Skipping the scenario : " + typeNameTag + ", as scenario is disabled.");
                                    continue;
                                }
                                scenarioConfigMapper.setDataProvider(params.getOrDefault(ProjectKeywords.DATA_PROVIDER.getKeyword(), null));
                                scenarioConfigMapper.setFilePath(params.getOrDefault(ProjectKeywords.FILE_PATH.getKeyword(), null));
                            } else {
                                logger.info("No additional param mapping found. Hence will test scenario : " + typeNameTag + " using default configuration.");
                            }

                            /*for type=scenario, scenario names should be unique*/
                            if (type.equalsIgnoreCase(ProjectKeywords.SCENARIO.getKeyword()) || type.equalsIgnoreCase(ProjectKeywords.STORY.getKeyword())) {
                                if (projectOverview.getScenariosDetails().containsKey(typeNameTag)) {
                                    logger.info("Skipping the scenario : " + line + ", as it contains duplicate scenario name.");
                                    validationErrorDetailsList.add(new FlowValidationErrorDetails(flowFileName, typeNameTag, -1, line, ParseExceptionType.NAME_NOT_UNIQUE, "{ flow file : " + flowFileName + ", type : " + type + ", name: " + typeNameTag + ", step : " + line + "}", "Scenario name must be unique."));
                                }
                            } else {
                                logger.info("Dependency mapping found. Will try to map the scenario: '" + typeNameTag + "' in the flow execution");
                            }
                            List<String> steps = new ArrayList<>();
                            List<ExecutableStep<ActionMapper>> stepList = new ArrayList<>();
                            int stepNumber;
                            if (type.equalsIgnoreCase(ProjectKeywords.SCENARIO.getKeyword()) || type.equalsIgnoreCase(ProjectKeywords.STORY.getKeyword())) {
                                stepNumber = 0;
                                /*The following loop evaluates the next lines as 'steps' for given 'type:scenario' until it encounters an 'empty' or 'null' line.*/
                                while ((line = bufferedScenarioFile.readLine()) != null && !line.isEmpty()) {
                                    stepNumber++;
                                    //if line starts with "//", then it is treated as a comment line and ignored.
                                    if (line.startsWith(ProjectKeywords.COMMENT_LINE.getKeyword()))
                                        continue;
                                    steps.add(line);
                                    StepData stepData;
                                    Input input;
                                    Output output;
                                    //List<String> stepValues = extractData("[@](.*?)[\\s]|['](.*?)[']|[~](.*?)[~]", line);
                                    String actionName = extractData("[+](.*?)[+]", line);
                                    if (actionName == null || actionName.equals("")) {
                                        validationErrorDetailsList.add(new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.INTENT_MAPPING_ISSUE, "Did you specify intent?", "define valid intent as : +intent+"));
                                        continue;
                                    }
                                    logger.info("got action name : " + actionName);
                                    ActionMapper action = ActionDictionaryMapper.getInstance().getAction(actionName);
                                    Class classVar = ActionDictionaryMapper.getInstance().getActionClass(action);
                                    if (classVar == null) {
                                        validationErrorDetailsList.add(new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.INTENT_MAPPING_ISSUE, "Did not find corresponding intent mapping for key : " + actionName, "define valid intent as : +intent+"));
                                        continue;
                                    }
                                    if (classVar.equals(SeleniumActionMapper.class)) {
                                        stepData = new SeleniumStepData();
                                        input = new SeleniumInput();
                                        output = new SeleniumOutput();
                                    } else if (classVar.equals(HttpActionMapper.class)) {
                                        stepData = new ApiStepData();
                                        input = new ApiInput();
                                        output = new ApiOutput();
                                    } else {
                                        stepData = new SeleniumStepData();
                                        input = new SeleniumInput();
                                        output = new SeleniumOutput();
                                    }
                                    if (action == null) {
                                        validationErrorDetailsList.add(new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.INTENT_MAPPING_ISSUE, "Did not find corresponding intent mapping for key : " + actionName, "define valid intent as : +intent+"));
                                        continue;
                                    }
                                    String dataSet = extractData("[*](.*?)[*]", line);
                                    if (dataSet != null) {
                                        //RULE : Input data set is a list of strings separated by comma
                                        //RULE : Input data can be a variable.  If so, then it should start with a HASH
                                        //RULE : Input data as variables from different story/scenario must start with a HASH followed by story/scenario name, then a dot and then the variable name
                                        List<String> dataList = FileUtil.commaSplitter(dataSet);
                                        input.setInputDataList(dataList);
                                    } else {
                                        input.setInputDataList(Collections.EMPTY_LIST);
                                    }
                                    if (actionName != null && !classVar.equals(HttpActionMapper.class) && !LocatorNotRequiredMapper.getActionsWithoutLocatorsSet().contains(ActionDictionaryMapper.getInstance().getAction(actionName))) {
                                        String identityInfo = extractData("[~](.*?)[~]", line);
                                        List<String> locatorList = Collections.emptyList();
                                        if (identityInfo != null) {
                                            identityInfo = identityInfo.trim();
                                            if (identityInfo.contains(":"))
                                                locatorList = Arrays.asList(identityInfo.split(ProjectKeywords.AND.getKeyword()));
                                            else {
                                                if (config.getLocatorMapping().containsKey(identityInfo)) {
                                                    String value = config.getLocatorMapping().get(identityInfo);
                                                    locatorList = Arrays.asList(value.split(ProjectKeywords.AND.getKeyword()));
                                                } else {
                                                    validationErrorDetailsList.add(new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.IDENTITY_MAPPING_ISSUE, scenarioExceptionMessage(line), " check > locatorDetails : " + identityInfo + " for errors."));
                                                }
                                            }
                                        } else {
                                            logger.error("locator not found, does this line require a locator? " + scenarioExceptionMessage(line));
                                            validationErrorDetailsList.add(new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.IDENTITY_MAPPING_ISSUE, scenarioExceptionMessage(line), " please define identity (locator) for intent : " + actionName));
                                        }
                                        LocatorMap locatorMap = new LocatorMap();
                                        for (String locatorDetails : locatorList) {
                                            String[] kv = new String[2];
                                            try {
                                                kv[0] = locatorDetails.substring(0, locatorDetails.indexOf(":"));
                                                kv[1] = locatorDetails.substring(locatorDetails.indexOf(":") + 1);
                                                logger.info("locatorType : " + kv[0] + ", locator : " + kv[1]);
                                            } catch (Exception e) {
                                                logger.info(scenarioExceptionMessage(line));
                                                validationErrorDetailsList.add(new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.IDENTITY_MAPPING_ISSUE, scenarioExceptionMessage(line), " check > locatorDetails : " + locatorDetails + " for errors."));
                                            }
                                            if (LocatorType.getLocatorType(kv[0].trim()) == null)
                                                validationErrorDetailsList.add(new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.IDENTITY_MAPPING_ISSUE, scenarioExceptionMessage(line), " This is not a valid locator type : " + kv[0].trim()));
                                            locatorMap.addTypeAndLocator(LocatorType.getLocatorType(kv[0].trim()), kv[1].trim());
                                        }
                                        input.set(locatorMap);
                                    } else if (classVar.equals(HttpActionMapper.class)) {
                                        String identityInfo = extractData("[~](.*?)[~]", line);
                                        ApiRequest apiRequest = projectOverview.getApiCallsMap().get(identityInfo);
                                        if (apiRequest == null)
                                            validationErrorDetailsList.add(new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.API_CALL_NOT_FOUND, scenarioExceptionMessage(line), " There is no api call saved with this name : " + identityInfo));
                                        input.set(apiRequest);
                                    }
                                    String stepVariable = extractData("var\\s*:\\s*(\\S+)", line);
                                    if (stepVariable == null) {
                                        String arr[] = extractData("var\\s*[(](.*?)[)]\\s*:\\s*(\\S+)", line, new int[]{1, 2});
                                        output.set(arr[0]);
                                        stepVariable = arr[1];
                                    }

                                    if (actionName != null) {
                                        stepData.setInputData(input);
                                        stepData.setOutputData(output);
                                        stepList.add(new ExecutableStep<>(actionName, action, stepData, stepVariable));
                                    }
                                }
                                if (type.equalsIgnoreCase(ProjectKeywords.STORY.getKeyword()))
                                    projectOverview.addStoryEntry(type, typeNameTag, new ScenarioDetails<>(scenarioConfigMapper, steps, stepList));
                                else
                                    projectOverview.addScenarioEntry(type, flowFileName, typeNameTag, new ScenarioDetails<>(scenarioConfigMapper, steps, stepList));
                            } else if (type.equalsIgnoreCase(ProjectKeywords.TEST.getKeyword())) {
                                projectOverview.addExecutionEntry(type, flowFileName, typeNameTag);
                            } else if (type.equalsIgnoreCase(ProjectKeywords.COMPOSE.getKeyword())) {
                                stepNumber = 0;
                                while ((line = bufferedScenarioFile.readLine()) != null && !line.isEmpty()) {
                                    stepNumber++;
                                    //if line starts with "//", then it is treated as a comment line and ignored.
                                    if (line.startsWith(ProjectKeywords.COMMENT_LINE.getKeyword()))
                                        continue;
                                    steps.add(line);
                                    line = line.trim().replaceAll(" +", " ");
                                    projectOverview.addCompositionEntry(typeNameTag, line);
                                }
                            } else {
                                logger.error(scenarioExceptionMessage(line, "'" + type + "' type not supported."));
                                validationErrorDetailsList.add(new FlowValidationErrorDetails(flowFileName, typeNameTag, -1, line, ParseExceptionType.SYNTAX_ISSUE, scenarioExceptionMessage(line), "'" + type + "' type is currently not supported."));
                            }

                        } else {
                            logger.info("waiting for a valid type:{scenario|story|test|compose} to get started...");
                            validationErrorDetailsList.add(new FlowValidationErrorDetails(flowFileName, null, -1, line, ParseExceptionType.SYNTAX_ISSUE, scenarioExceptionMessage(line), "flows should be made up of valid types:{scenario|story|compose|test}."));
                        }
                    }
                }
            } catch (IOException ioe) {
                ioe.printStackTrace();
                validationErrorDetailsList.add(new FlowValidationErrorDetails(scenarioFile.getName(), null, -1, null, ParseExceptionType.FILE_READ_ISSUE, ioe.getMessage()));
            }
        }
        return validationErrorDetailsList;
    }

    public void setApiCallsMap(Map<String, ApiRequest> apiCallsMap) {
        this.apiCallsMap = apiCallsMap;
    }

    /****************************************************************************************
     * Method to execute flow/s defined by the given list of flow files.
     *
     * @param line proper step line containing an action. Action must be extractable
     *
     * @throws NullPointerException if ActionDictionaryMapper does not contain the action.
     * @throws InstantiationException if property files are not specified in configuration
     *                                but accessed
     * ***************************************************************************************/
    public String getActionMapperClass(String line) throws InstantiationException{
        String actionName = extractData("[+](.*?)[+]", line);
        if(actionName == null)
            throw new InstantiationException("Is action properly specified? check line : " +line);
                ActionMapper<?> action = ActionDictionaryMapper.getInstance().getAction(actionName);
        Class<?> classVar = ActionDictionaryMapper.getInstance().getActionClass(action);
        return classVar.getSimpleName();
    }

    private String extractMetaData(String metaData) {
        String data = null;
        Pattern pattern = Pattern.compile("[(](.*?)[)]");
        Matcher matcher = pattern.matcher(metaData);
        while (matcher.find()) {
            data = matcher.group(1);
            break;
        }
        return data;
    }

    private String extractData(String patternString, String data) {
        List<String> dataSet = new ArrayList<>();
        Pattern pattern = Pattern.compile(patternString);
        Matcher matcher = pattern.matcher(data);
        while (matcher.find()) {
            dataSet.add(matcher.group(1));
        }
        if (dataSet.isEmpty())
            return null;
        return dataSet.get(0);
    }

    private String[] extractData(String patternString, String data, int[] group) {
        String[] dataSet = new String[group.length];
        Pattern pattern = Pattern.compile(patternString);
        Matcher matcher = pattern.matcher(data);
        while (matcher.find()) {
            for (int i = 0; i < group.length; i++)
                dataSet[i] = matcher.group(group[i]);
        }
        return dataSet;
    }

    private String scenarioExceptionMessage() {
        return "Format error. Please refer the Scenario creation documentation.";
    }

    private String scenarioExceptionMessage(String errorMessage) {
        return "Format error in line : " + errorMessage + ". Please refer the flow creation documentation.";
    }

    private String scenarioExceptionMessage(String errorMessage, String expectedMessage) {
        return "Format error in line : " + errorMessage + ", expected : " + expectedMessage;
    }
}
