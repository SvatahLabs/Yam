package com.svatah.automator.parser;

import com.svatah.automator.containers.*;
import com.svatah.automator.core.Config;
import com.svatah.automator.exceptions.ProjectAlreadyRegisteredException;
import com.svatah.automator.exceptions.ScenarioParseException;
import com.svatah.automator.mappers.*;
import com.svatah.automator.mappers.ActionSynonyms;
import com.svatah.automator.utils.FileFinder;
import com.svatah.automator.utils.Logging;

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
 * Created by atul on 12/09/17.
 */
public class SvatahParserV1 {

    private boolean safeMode;
    private Config config;
    private Logging logging = new Logging(InfoLevel.INFO);
    private Map<String, ApiRequest> apiCallsMap = Collections.emptyMap();

    public boolean isSafeMode() {
        return safeMode;
    }

    public SvatahParserV1(boolean safeMode, Config config) {
        this.config = config;
        this.safeMode = safeMode;
        try {
            new ActionSynonyms(config.getBuildType());
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public void setApiCallsMap(Map<String, ApiRequest> apiCallsMap){
        this.apiCallsMap = apiCallsMap;
    }

    public void loadScenarios(Long id, Config config) throws IOException {
        Path startingDir = Paths.get(config.getFlowsRootPath());
        logging.log("Starting Dir : " + startingDir);
        String pattern = "*.flow";
        FileFinder.Finder finder = new FileFinder.Finder(pattern);
        Files.walkFileTree(startingDir, finder);
        for (Path path : finder.getPathList()) {
            logging.log(path.toString());
            flowFileParser(id, path.toFile(), config);
        }
    }

    public void loadScenarios(Long id, List<File> scenarioFiles, Config config) throws IOException {
        for (File file : scenarioFiles)
            flowFileParser(id, file, config);
    }

    public List<FlowValidationErrorDetails> validate(Long id, List<File> scenarioFiles, Config config) {
        List<FlowValidationErrorDetails> validationErrorDetailsList = new ArrayList<>();
        safeMode = false;
        for (File file : scenarioFiles) {
            try {
                flowFileParser(id, file, config);
            } catch (IOException e) {
                FlowValidationErrorDetails validationErrorDetails = new FlowValidationErrorDetails(file.getName(), null, -1, null, ParseExceptionType.FILE_READ_ISSUE, e.getMessage());
                validationErrorDetailsList.add(validationErrorDetails);
            }
            catch (ScenarioParseException spe){
                validationErrorDetailsList.add(spe.getErrorDetails());
            }
        }
        return validationErrorDetailsList;
    }

    private void flowFileParser(Long id, File scenarioFile, Config config) throws IOException {
        ProjectOverview projectOverview;
        try {
            projectOverview = ThreadedDataHandler.getInstance().registerProjectOverview(id, config);
        } catch (ProjectAlreadyRegisteredException e) {
            logging.log("scenario already registered with this id  : "+e.getMessage());
            projectOverview = ThreadedDataHandler.getInstance().getProjectOverview(id);
        }
        String flowFileName = scenarioFile.getName();
        try (BufferedReader br = new BufferedReader(new FileReader(scenarioFile))) {
            String line;
            while ((line = br.readLine()) != null) {
                //if line starts with "//", then it is treated as a comment line and ignored.
                if (line.startsWith(ProjectKeywords.COMMENT_LINE.getKeyword()))
                    continue;
                //Firstly the parser searches for Begin Keyword to add a scenario to executor.
                if (line.equalsIgnoreCase(ProjectKeywords.BEGIN.getKeyword())) {
                    //once it finds begin, it reads the next line
                    line = br.readLine();
                    //if line starts with "//", then it is treated as a comment line and ignored.
                    while (line.startsWith(ProjectKeywords.COMMENT_LINE.getKeyword())) {
                        line = br.readLine();
                    }
                    if (!line.isEmpty()) {
                        //parser needs to determine the type {scenario, execute, compose}
                        /*validating whether the type line conforms to parameters*/
                        List<String> typeData = extractData(line);
                        if (typeData.size() != 1) {
                            if (!safeMode)
                                throw new ScenarioParseException(scenarioExceptionMessage(line), new FlowValidationErrorDetails(flowFileName, null, -1, line, ParseExceptionType.SYNTAX_ISSUE, scenarioExceptionMessage(line), "define type {scenario, execute, compose} properly"));
                            else {
                                logging.log(scenarioExceptionMessage(line, "as running in safeMode, evaluating next scenario, if any."));
                                continue;
                            }
                        }
                        /**/
                        /*extracting type and typeNameTag it is stored as $[type:typeNameTag]$*/
                        String[] typeInfoLine = typeData.get(0).replaceAll("\\s", "").split(":");
                        if (typeInfoLine.length != 2) {
                            if (!safeMode)
                                throw new ScenarioParseException(scenarioExceptionMessage(line), new FlowValidationErrorDetails(flowFileName, null, -1, line, ParseExceptionType.SYNTAX_ISSUE, scenarioExceptionMessage(line), "type and typeNameTag should be stored as $[type:typeNameTag]$"));
                            else {
                                logging.log(scenarioExceptionMessage(line, "as running in safeMode, evaluating next scenario, if any."));
                                continue;
                            }
                        }
                        /**/
                        String typeNameTag;
                        typeNameTag = typeInfoLine[1];
                        String type = typeInfoLine[0].split("\\(")[0];
                        /*for type=scenario, scenario names should be unique*/
                        if (projectOverview.getScenariosDetails().containsKey(typeNameTag)) {
                            if (!type.equalsIgnoreCase(ProjectKeywords.TEST.getKeyword())) {
                                if (!safeMode)
                                    throw new ScenarioParseException(scenarioExceptionMessage("{ flow file : "+flowFileName+", type : "+type+", name: "+typeNameTag+", step : "+line+"}", "Scenario name must be unique."), new FlowValidationErrorDetails(flowFileName, null, -1, line, ParseExceptionType.NAME_NOT_UNIQUE, "{ flow file : "+flowFileName+", type : "+type+", name: "+typeNameTag+", step : "+line+"}", "Scenario name must be unique."));
                                else {
                                    logging.log("Skipping the scenario : " + line + ", as it contains duplicate scenario name.");
                                    continue;
                                }
                            } else {
                                logging.log("Dependency mapping found. Will map the scenario: '" + typeNameTag + "' in the flow execution");
                            }
                        }

                        String methodCallMetaData = extractMetaData(typeInfoLine[0]);
                        ScenarioConfigMapper scenarioConfigMapper = new ScenarioConfigMapper();
                        if (methodCallMetaData != null) {
                            logging.log("Additional param mapping found for " + type + " : " + typeNameTag);
                            String[] methodConfKVPair = methodCallMetaData.replaceAll("\\s", "").split(",");
                            Map<String, String> params = new HashMap<>();
                            for (String kvPair : methodConfKVPair) {
                                String[] kv = kvPair.split("=");
                                if (kv.length != 2) {
                                    if (!safeMode)
                                        throw new ScenarioParseException(scenarioExceptionMessage(line, "Scenario params must be in format > (key=value, k2=v2,..)") , new FlowValidationErrorDetails(flowFileName, null, -1, line, ParseExceptionType.SYNTAX_ISSUE, scenarioExceptionMessage(line), "Scenario params must be in format > (key=value, k2=v2,..)"));
                                    else {
                                        logging.log("Skipping the scenario : " + line + ", as scenario params must are not in format > (key=value, k2=v2,..)");
                                        continue;
                                    }
                                }
                                params.put(kv[0].toLowerCase(), kv[1].toLowerCase());
                            }
                            if (params.get(ProjectKeywords.ENABLED.getKeyword()) != null && params.get(ProjectKeywords.ENABLED.getKeyword()).equalsIgnoreCase("false")) {
                                logging.log("Skipping the scenario : " + typeNameTag + ", as scenario is disabled.");
                                continue;
                            }
                            scenarioConfigMapper.setDataProvider(params.getOrDefault(ProjectKeywords.DATA_PROVIDER.getKeyword(), null));
                            scenarioConfigMapper.setFilePath(params.getOrDefault(ProjectKeywords.FILE_PATH.getKeyword(), null));
                            /******************************* FUTURE IMPLEMENTATION *****************************
                             scenarioConfigMapper.setDependsOnScenario(params.getOrDefault(ProjectKeywords.DEPENDS_ON_SCENARIO.getType(),null));
                             ************************************************************************************/
                        } else {
                            logging.log("No additional param mapping found. Hence will execute scenario : " + typeNameTag + " using default configuration.");
                        }
                        List<String> steps = new ArrayList<>();
                        List<ExecutableStep<SeleniumActionMapper>> stepList = new ArrayList<>();
                        if (type.equalsIgnoreCase(ProjectKeywords.SCENARIO.getKeyword())) {
                        /*The following loop evaluates the next lines as 'steps' for given 'type:scenario' until it encounters an 'end' tag.*/
                        int stepNumber=0;
                            while ((line = br.readLine()) != null && !line.equalsIgnoreCase(ProjectKeywords.END.getKeyword())) {
                                stepNumber++;
                                //if line starts with "//", then it is treated as a comment line and ignored.
                                if (line.startsWith(ProjectKeywords.COMMENT_LINE.getKeyword()))
                                    continue;
                                steps.add(line);
                                ActionMapper action = null;
                                String actionName = null;
                                SeleniumStepData seleniumStepData = new SeleniumStepData();
                                List<String> stepValues = extractData(line);
                                String locator = "" ;
                                LocatorType locatorType = null;
                                for (String kvPair : stepValues) {
                                    kvPair = kvPair.trim();
                                    String[] kv=new String[2];
                                    try {
                                        kv[0] = kvPair.substring(0,kvPair.indexOf(":"));
                                        kv[1] =  kvPair.substring(kvPair.indexOf(":")+1);
                                        logging.log("keyword : " + kv[0] + ", value : "+kv[1]);
                                    }catch(Exception e){
                                        if (!safeMode)
                                            throw new ScenarioParseException(scenarioExceptionMessage(line)+" check > "+kvPair+" for errors.", new FlowValidationErrorDetails(flowFileName, typeNameTag, stepNumber, line, ParseExceptionType.SYNTAX_ISSUE, scenarioExceptionMessage(line), " check > "+kvPair+" for errors."));
                                        else {
                                            logging.log(scenarioExceptionMessage(line, "as running in safeMode, evaluating next scenario, if any."));
                                            continue;
                                        }
                                    }
                                    String keyword = kv[0].trim(), mappingValue = kv[1].trim();
                                    if (keyword.equalsIgnoreCase(ProjectKeywords.ACTION.getKeyword())) {
                                        actionName = mappingValue;
                                        action = ActionDictionaryMapper.getInstance().getAction(actionName);
                                    } else if (keyword.equalsIgnoreCase(ProjectKeywords.LOCATOR.getKeyword())) {
                                        if (mappingValue.startsWith(ProjectKeywords.HASH.getKeyword()) && mappingValue.endsWith(ProjectKeywords.HASH.getKeyword()))
                                            locator = (config.getLocatorMapping().get(mappingValue.replaceAll(ProjectKeywords.HASH.getKeyword(), "")));
                                        else
                                            locator = (mappingValue);
                                    } else if (keyword.equalsIgnoreCase(ProjectKeywords.LOCATOR_TYPE.getKeyword())) {
                                        locatorType = (LocatorType.getLocatorType(mappingValue));
                                    } else if (keyword.equalsIgnoreCase(ProjectKeywords.DATA.getKeyword())) {
                                        List<String> dataList = (Arrays.asList(mappingValue.split(",")));
//                                        int dataIndex = 0;
//                                        for (Object data : dataList) {
//                                            if (data.toString().startsWith(ProjectKeywords.HASH.getType()) && data.toString().endsWith(ProjectKeywords.HASH.getType()))
//                                                dataList.add(dataIndex, ProjectOverview.getInstance().getScenariosResultMap().getOrDefault(data.toString().replaceAll(ProjectKeywords.HASH.getType(), ""),null));
//                                            dataIndex++;
//                                        }
                                        SeleniumInput seleniumInput = new SeleniumInput();
                                        seleniumInput.setInputDataList(dataList);
                                        seleniumStepData.setInputData(seleniumInput);
                                    } else {
                                        logging.log("The keyword : " + keyword + " is not supported at step level.");
                                    }
                                }
                                LocatorMap typeAndLocatorMap = new LocatorMap();
                                typeAndLocatorMap.addTypeAndLocator(locatorType, locator);
                                SeleniumInput seleniumInput = new SeleniumInput();
                                seleniumInput.set(typeAndLocatorMap);
                                seleniumStepData.setInputData(seleniumInput);
                                if (actionName != null) {
                                    stepList.add(new ExecutableStep(actionName, action, seleniumStepData));
                                }
                            }
                            projectOverview.addScenarioEntry(type, flowFileName, typeNameTag, new ScenarioDetails(scenarioConfigMapper, steps, stepList));
                        } else if (type.equalsIgnoreCase(ProjectKeywords.TEST.getKeyword())) {
                            line = br.readLine();
                            if (!line.equalsIgnoreCase(ProjectKeywords.END.getKeyword())) {
                                if (!safeMode)
                                    throw new ScenarioParseException(scenarioExceptionMessage(line, "Only one execute allowed within Begin-End relationship"), new FlowValidationErrorDetails(flowFileName, typeNameTag, -1, line, ParseExceptionType.SYNTAX_ISSUE, scenarioExceptionMessage(line), "Only one TEST allowed within Begin-End relationship "));
                                else {
                                    logging.log(scenarioExceptionMessage(line, "Only one execute allowed within Begin-End relationship. As running in safeMode, evaluating next scenario, if any."));
                                    continue;
                                }
                            }
                            projectOverview.addScenarioEntry(type, flowFileName, typeNameTag, new ScenarioDetails(scenarioConfigMapper, steps, stepList));
                        } else if (type.equalsIgnoreCase(ProjectKeywords.COMPOSE.getKeyword())) {
                            while ((line = br.readLine()) != null && !line.equalsIgnoreCase(ProjectKeywords.END.getKeyword())) {
                                //if line starts with "//", then it is treated as a comment line and ignored.
                                if (line.startsWith(ProjectKeywords.COMMENT_LINE.getKeyword()))
                                    continue;
                                steps.add(line);

                                List<String> stepValues = extractData(line);
                                for (String kvPair : stepValues) {
                                    String[] kv = kvPair.replaceAll("\\s", "").split(":");
                                    if (kv.length != 2) {
                                        if (!safeMode)
                                            throw new ScenarioParseException(scenarioExceptionMessage(line), new FlowValidationErrorDetails(flowFileName, typeNameTag, -1, line, ParseExceptionType.COMPOSITION_NOT_FOUND, scenarioExceptionMessage(line), " check > "+kvPair+" for errors in the Composition."));
                                        else {
                                            logging.log(scenarioExceptionMessage(line, "as running in safeMode, evaluating next scenario, if any."));
                                            continue;
                                        }
                                    }
                                    String keyword = kv[0], mappingValue = kv[1];
                                    if (keyword.equalsIgnoreCase(ProjectKeywords.ADD.getKeyword())) {
                                        projectOverview.addCompositionEntry(typeNameTag, mappingValue);
                                    }
                                }
                            }
                        } else {
                            if (!safeMode)
                                throw new ScenarioParseException(scenarioExceptionMessage(line, "'" + type + "' type not supported."), new FlowValidationErrorDetails(flowFileName, typeNameTag, -1, line, ParseExceptionType.SYNTAX_ISSUE, scenarioExceptionMessage(line), "'" + type + "' type is currently not supported."));
                            else {
                                logging.log(scenarioExceptionMessage(line, "'" + type + "' type not supported. As running in safeMode, evaluating next scenario, if any."));
                                continue;
                            }
                        }
                    }
                }
            }
        }
        /************************************** FUTURE IMPLEMENTATION **************************************************
         List<DependencyPair> invalidScenarioNameList = dependentScenariosMappingAndValidation();
         if(!invalidScenarioNameList.isEmpty()){
         if (!safeMode)
         throw new ScenarioParseException(scenarioExceptionMessage("Invalid dependency mapping/s found : "+invalidScenarioNameList.toString()));
         else {
         logging.log(scenarioExceptionMessage("Invalid dependency mapping/s found : "+invalidScenarioNameList.toString(), "as running in safeMode excluding these scenarios."));
         for(DependencyPair scenario : invalidScenarioNameList )
         projectOverview.getScenariosDetails().remove(scenario.getCurrentScenario());
         }
         }
         ****************************************************************************************************************/
    }

    private List<String> extractData(String data) {
        List<String> dataSet = new ArrayList<>();
        Pattern pattern = Pattern.compile("[$]\\[(.*?)][$]");
        Matcher matcher = pattern.matcher(data);
        while (matcher.find()) {
            dataSet.add(matcher.group(1));
        }
        return dataSet;
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

//    private List<DependencyPair> dependentScenariosMappingAndValidation(){
//        List<DependencyPair> invalidScenarioNameList = new ArrayList<>();
//        ProjectOverview scenariosOverview = ProjectOverview.getInstance();
//        DependencyMap dependencyMap = DependencyMap.getInstance();
//        for(String scenarioName: scenariosOverview.getScenariosDetails().keySet())
//            dependencyMap.addScenarioEntry(new DependencyPair(scenarioName,scenariosOverview.getScenariosDetails().get(scenarioName).getScenarioMetaData().getDependsOnScenario()));
//        List<DependencyPair> sortedByCurrentScenarioList = new ArrayList<>();
//        sortedByCurrentScenarioList.addAll(dependencyMap.getDependencyPairList());
//        Collections.sort(sortedByCurrentScenarioList);
//        Comparator<DependencyPair> dependencyPairComparator = new Comparator<DependencyPair>() {
//            @Override
//            public int compare(DependencyPair o1, DependencyPair o2) {
//                if(o2.getDependsOnScenario()!=null)
//                    return o1.getCurrentScenario().compareTo(o2.getDependsOnScenario());
//                return 0;
//            }
//        };
//
//        for(DependencyPair dependencyPair : sortedByCurrentScenarioList) {
//            int value = Collections.binarySearch(sortedByCurrentScenarioList, dependencyPair, dependencyPairComparator);
//            if(value<0){
//                invalidScenarioNameList.add(dependencyPair);
//            }
//        }
//        return invalidScenarioNameList;
//    }

    private String scenarioExceptionMessage() {
        return "Format error. Please refer the Scenario creation documentation.";
    }

    private String scenarioExceptionMessage(String errorMessage) {
        return "Format error in line : " + errorMessage +
                "\nPlease refer the Scenario creation documentation.";
    }

    private String scenarioExceptionMessage(String errorMessage, String expectedMessage) {
        return "Format error in line : " + errorMessage +
                "\n" + expectedMessage + "\n";
    }
}

