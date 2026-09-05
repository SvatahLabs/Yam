package com.svatah.automator.parser;

import com.svatah.automator.utils.FileFinder;
import com.svatah.automator.utils.FileUtil;
import org.apache.logging.log4j.LogManager;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;

/**
 * Syntax Migration Tool - Migrates flow files from old delimiter-based format to new natural language format.
 * 
 * Old Format (with delimiters):
 * - [+click+] [+id:loginButton+]
 * - [+type+] [+id:username+] [*admin@example.com*]
 * - [+verify+] [+text:Welcome+]
 * 
 * New Format (natural language):
 * - "Click the login button"
 * - "Type admin@example.com into the username field"
 * - "Verify the Welcome message appears"
 * 
 * This tool automatically converts old format files to the new format.
 */
public class SyntaxMigrationTool {

    private static final org.apache.logging.log4j.Logger logger = LogManager.getLogger(SyntaxMigrationTool.class);
    
    // Pattern to match old delimiter format
    private static final Pattern OLD_ACTION_PATTERN = Pattern.compile("\\[\\+(\\w+)\\+\\]");
    private static final Pattern OLD_LOCATOR_PATTERN = Pattern.compile("\\[\\~(\\w+:[^\\]]+)\\~\\]");
    private static final Pattern OLD_DATA_PATTERN = Pattern.compile("\\[(\\*|\\^)([^\\]]+)\\1\\]");
    
    // Action mappings from old format to natural language
    private static final Map<String, String> ACTION_MAPPINGS = new HashMap<>();
    static {
        ACTION_MAPPINGS.put("click", "click the");
        ACTION_MAPPINGS.put("type", "type");
        ACTION_MAPPINGS.put("enter", "enter");
        ACTION_MAPPINGS.put("input", "input");
        ACTION_MAPPINGS.put("fill", "fill");
        ACTION_MAPPINGS.put("set", "set");
        ACTION_MAPPINGS.put("write", "write");
        ACTION_MAPPINGS.put("send", "send");
        ACTION_MAPPINGS.put("verify", "verify that");
        ACTION_MAPPINGS.put("assert", "assert that");
        ACTION_MAPPINGS.put("check", "check that");
        ACTION_MAPPINGS.put("confirm", "confirm that");
        ACTION_MAPPINGS.put("ensure", "ensure that");
        ACTION_MAPPINGS.put("validate", "validate that");
        ACTION_MAPPINGS.put("navigate", "navigate to");
        ACTION_MAPPINGS.put("go", "go to");
        ACTION_MAPPINGS.put("open", "open");
        ACTION_MAPPINGS.put("visit", "visit");
        ACTION_MAPPINGS.put("load", "load");
        ACTION_MAPPINGS.put("wait", "wait for");
        ACTION_MAPPINGS.put("hover", "hover over");
        ACTION_MAPPINGS.put("select", "select");
        ACTION_MAPPINGS.put("choose", "choose");
        ACTION_MAPPINGS.put("drag", "drag");
        ACTION_MAPPINGS.put("drop", "drop");
        ACTION_MAPPINGS.put("scroll", "scroll to");
        ACTION_MAPPINGS.put("refresh", "refresh the page");
        ACTION_MAPPINGS.put("reload", "reload the page");
        ACTION_MAPPINGS.put("back", "go back");
        ACTION_MAPPINGS.put("forward", "go forward");
        ACTION_MAPPINGS.put("close", "close");
        ACTION_MAPPINGS.put("minimize", "minimize");
        ACTION_MAPPINGS.put("maximize", "maximize");
        ACTION_MAPPINGS.put("switch", "switch to");
        ACTION_MAPPINGS.put("accept", "accept");
        ACTION_MAPPINGS.put("dismiss", "dismiss");
        ACTION_MAPPINGS.put("upload", "upload");
        ACTION_MAPPINGS.put("download", "download");
        ACTION_MAPPINGS.put("submit", "submit");
        ACTION_MAPPINGS.put("save", "save");
        ACTION_MAPPINGS.put("cancel", "cancel");
        ACTION_MAPPINGS.put("delete", "delete");
        ACTION_MAPPINGS.put("remove", "remove");
        ACTION_MAPPINGS.put("add", "add");
        ACTION_MAPPINGS.put("create", "create");
        ACTION_MAPPINGS.put("edit", "edit");
        ACTION_MAPPINGS.put("update", "update");
        ACTION_MAPPINGS.put("search", "search for");
        ACTION_MAPPINGS.put("find", "find");
        ACTION_MAPPINGS.put("filter", "filter");
        ACTION_MAPPINGS.put("sort", "sort");
        ACTION_MAPPINGS.put("clickLink", "click the link");
        ACTION_MAPPINGS.put("clickText", "click the text");
        ACTION_MAPPINGS.put("clickId", "click the element with id");
        ACTION_MAPPINGS.put("clickName", "click the element with name");
        ACTION_MAPPINGS.put("clickXpath", "click the element at xpath");
        ACTION_MAPPINGS.put("clickCss", "click the element with css");
        ACTION_MAPPINGS.put("clickClass", "click the element with class");
        ACTION_MAPPINGS.put("clickTag", "click the element with tag");
        ACTION_MAPPINGS.put("clickLinkText", "click the link with text");
        ACTION_MAPPINGS.put("clickPartialLink", "click the link with partial text");
        ACTION_MAPPINGS.put("clickImage", "click the image");
        ACTION_MAPPINGS.put("clickCoord", "click at coordinates");
        ACTION_MAPPINGS.put("clickElement", "click the element");
        ACTION_MAPPINGS.put("clickButton", "click the button");
        ACTION_MAPPINGS.put("clickCheckbox", "click the checkbox");
        ACTION_MAPPINGS.put("clickRadio", "click the radio button");
        ACTION_MAPPINGS.put("clickDropdown", "click the dropdown");
        ACTION_MAPPINGS.put("clickSelect", "click the select");
        ACTION_MAPPINGS.put("clickInput", "click the input field");
        ACTION_MAPPINGS.put("clickTextarea", "click the textarea");
        ACTION_MAPPINGS.put("clickTable", "click the table");
        ACTION_MAPPINGS.put("clickRow", "click the row");
        ACTION_MAPPINGS.put("clickCell", "click the cell");
        ACTION_MAPPINGS.put("clickHeader", "click the header");
        ACTION_MAPPINGS.put("clickFooter", "click the footer");
        ACTION_MAPPINGS.put("clickMenu", "click the menu");
        ACTION_MAPPINGS.put("clickItem", "click the item");
        ACTION_MAPPINGS.put("clickOption", "click the option");
        ACTION_MAPPINGS.put("clickTab", "click the tab");
        ACTION_MAPPINGS.put("clickPane", "click the pane");
        ACTION_MAPPINGS.put("clickWindow", "click the window");
        ACTION_MAPPINGS.put("clickDialog", "click the dialog");
        ACTION_MAPPINGS.put("clickAlert", "click the alert");
        ACTION_MAPPINGS.put("clickConfirm", "click the confirm");
        ACTION_MAPPINGS.put("clickPrompt", "click the prompt");
        ACTION_MAPPINGS.put("clickModal", "click the modal");
        ACTION_MAPPINGS.put("clickPopup", "click the popup");
        ACTION_MAPPINGS.put("clickTooltip", "click the tooltip");
        ACTION_MAPPINGS.put("clickBadge", "click the badge");
        ACTION_MAPPINGS.put("clickIcon", "click the icon");
        ACTION_MAPPINGS.put("clickLabel", "click the label");
        ACTION_MAPPINGS.put("clickSpan", "click the span");
        ACTION_MAPPINGS.put("clickDiv", "click the div");
        ACTION_MAPPINGS.put("clickP", "click the paragraph");
        ACTION_MAPPINGS.put("clickA", "click the anchor");
        ACTION_MAPPINGS.put("clickB", "click the bold");
        ACTION_MAPPINGS.put("clickI", "click the italic");
        ACTION_MAPPINGS.put("clickU", "click the underline");
        ACTION_MAPPINGS.put("clickStrong", "click the strong");
        ACTION_MAPPINGS.put("clickEm", "click the emphasis");
        ACTION_MAPPINGS.put("clickSmall", "click the small");
        ACTION_MAPPINGS.put("clickMark", "click the mark");
        ACTION_MAPPINGS.put("clickCode", "click the code");
        ACTION_MAPPINGS.put("clickPre", "click the preformatted");
        ACTION_MAPPINGS.put("clickBlockquote", "click the blockquote");
        ACTION_MAPPINGS.put("clickCite", "click the citation");
        ACTION_MAPPINGS.put("clickQ", "click the quote");
        ACTION_MAPPINGS.put("clickAbbr", "click the abbreviation");
        ACTION_MAPPINGS.put("clickAcronym", "click the acronym");
        ACTION_MAPPINGS.put("clickAddress", "click the address");
        ACTION_MAPPINGS.put("clickArticle", "click the article");
        ACTION_MAPPINGS.put("clickAside", "click the aside");
        ACTION_MAPPINGS.put("clickAudio", "click the audio");
        ACTION_MAPPINGS.put("clickCanvas", "click the canvas");
        ACTION_MAPPINGS.put("clickData", "click the data");
        ACTION_MAPPINGS.put("clickDatalist", "click the datalist");
        ACTION_MAPPINGS.put("clickDetails", "click the details");
        ACTION_MAPPINGS.put("clickEmbed", "click the embed");
        ACTION_MAPPINGS.put("clickFigcaption", "click the figcaption");
        ACTION_MAPPINGS.put("clickFigure", "click the figure");
        ACTION_MAPPINGS.put("clickFooter", "click the footer");
        ACTION_MAPPINGS.put("clickHeader", "click the header");
        ACTION_MAPPINGS.put("clickHgroup", "click the hgroup");
        ACTION_MAPPINGS.put("clickIframe", "click the iframe");
        ACTION_MAPPINGS.put("clickImg", "click the image");
        ACTION_MAPPINGS.put("clickInput", "click the input");
        ACTION_MAPPINGS.put("clickKeygen", "click the keygen");
        ACTION_MAPPINGS.put("clickLabel", "click the label");
        ACTION_MAPPINGS.put("clickLegend", "click the legend");
        ACTION_MAPPINGS.put("clickLi", "click the li");
        ACTION_MAPPINGS.put("clickMap", "click the map");
        ACTION_MAPPINGS.put("clickMark", "click the mark");
        ACTION_MAPPINGS.put("clickMenu", "click the menu");
        ACTION_MAPPINGS.put("clickMeta", "click the meta");
        ACTION_MAPPINGS.put("clickMeter", "click the meter");
        ACTION_MAPPINGS.put("clickNav", "click the nav");
        ACTION_MAPPINGS.put("clickObject", "click the object");
        ACTION_MAPPINGS.put("clickOl", "click the ol");
        ACTION_MAPPINGS.put("clickOptgroup", "click the optgroup");
        ACTION_MAPPINGS.put("clickOutput", "click the output");
        ACTION_MAPPINGS.put("clickProgress", "click the progress");
        ACTION_MAPPINGS.put("clickRp", "click the rp");
        ACTION_MAPPINGS.put("clickRt", "click the rt");
        ACTION_MAPPINGS.put("clickRuby", "click the ruby");
        ACTION_MAPPINGS.put("clickSamp", "click the samp");
        ACTION_MAPPINGS.put("clickScript", "click the script");
        ACTION_MAPPINGS.put("clickSection", "click the section");
        ACTION_MAPPINGS.put("clickSelect", "click the select");
        ACTION_MAPPINGS.put("clickSource", "click the source");
        ACTION_MAPPINGS.put("clickSlot", "click the slot");
        ACTION_MAPPINGS.put("clickSpan", "click the span");
        ACTION_MAPPINGS.put("clickStyle", "click the style");
        ACTION_MAPPINGS.put("clickSummary", "click the summary");
        ACTION_MAPPINGS.put("clickTable", "click the table");
        ACTION_MAPPINGS.put("clickTbody", "click the tbody");
        ACTION_MAPPINGS.put("clickTd", "click the td");
        ACTION_MAPPINGS.put("clickTemplate", "click the template");
        ACTION_MAPPINGS.put("clickTextarea", "click the textarea");
        ACTION_MAPPINGS.put("clickTfoot", "click the tfoot");
        ACTION_MAPPINGS.put("clickTh", "click the th");
        ACTION_MAPPINGS.put("clickThead", "click the thead");
        ACTION_MAPPINGS.put("clickTime", "click the time");
        ACTION_MAPPINGS.put("clickTitle", "click the title");
        ACTION_MAPPINGS.put("clickTr", "click the tr");
        ACTION_MAPPINGS.put("clickTrack", "click the track");
        ACTION_MAPPINGS.put("clickU", "click the u");
        ACTION_MAPPINGS.put("clickUl", "click the ul");
        ACTION_MAPPINGS.put("clickVar", "click the var");
        ACTION_MAPPINGS.put("clickVideo", "click the video");
        ACTION_MAPPINGS.put("clickWbr", "click the wbr");
    }
    
    // Locator type to field name mappings
    private static final Map<String, String> LOCATOR_FIELD_MAPPINGS = new HashMap<>();
    static {
        LOCATOR_FIELD_MAPPINGS.put("id", "id");
        LOCATOR_FIELD_MAPPINGS.put("name", "name");
        LOCATOR_FIELD_MAPPINGS.put("xpath", "xpath");
        LOCATOR_FIELD_MAPPINGS.put("css", "css selector");
        LOCATOR_FIELD_MAPPINGS.put("class", "class");
        LOCATOR_FIELD_MAPPINGS.put("tag", "tag name");
        LOCATOR_FIELD_MAPPINGS.put("link", "link text");
        LOCATOR_FIELD_MAPPINGS.put("partialLink", "partial link text");
        LOCATOR_FIELD_MAPPINGS.put("text", "text");
        LOCATOR_FIELD_MAPPINGS.put("value", "value");
        LOCATOR_FIELD_MAPPINGS.put("type", "type");
        LOCATOR_FIELD_MAPPINGS.put("index", "index");
        LOCATOR_FIELD_MAPPINGS.put("dom", "DOM");
        LOCATOR_FIELD_MAPPINGS.put("js", "JavaScript");
        LOCATOR_FIELD_MAPPINGS.put("accessibility", "accessibility");
        LOCATOR_FIELD_MAPPINGS.put("image", "image");
        LOCATOR_FIELD_MAPPINGS.put("coord", "coordinates");
    }

    /**
     * Migrate a single flow file from old format to new format.
     */
    public static void migrateFile(File inputFile, File outputFile) throws IOException {
        logger.info("Migrating file: " + inputFile.getAbsolutePath());
        
        String content = new String(Files.readAllBytes(inputFile.toPath()));
        String migratedContent = migrateContent(content);
        
        Files.write(outputFile.toPath(), migratedContent.getBytes());
        logger.info("Migrated file saved to: " + outputFile.getAbsolutePath());
    }

    /**
     * Migrate content from old format to new format.
     */
    public static String migrateContent(String content) {
        StringBuilder result = new StringBuilder();
        String[] lines = content.split("\n");
        
        for (String line : lines) {
            String migratedLine = migrateLine(line);
            result.append(migratedLine).append("\n");
        }
        
        return result.toString();
    }

    /**
     * Migrate a single line from old format to new format.
     */
    public static String migrateLine(String line) {
        // Skip empty lines and comments
        if (line.trim().isEmpty() || line.trim().startsWith("//")) {
            return line;
        }
        
        // Check if line contains old format delimiters
        if (!line.contains("[+") && !line.contains("[~") && !line.contains("[*") && !line.contains("[^")) {
            return line;
        }
        
        // Extract action
        String action = extractAction(line);
        
        // Extract locators
        Map<String, String> locators = extractLocators(line);
        
        // Extract data
        List<String> data = extractData(line);
        
        // Build natural language sentence
        return buildNaturalLanguageSentence(action, locators, data);
    }

    /**
     * Extract action from old format line.
     */
    private static String extractAction(String line) {
        Matcher matcher = OLD_ACTION_PATTERN.matcher(line);
        if (matcher.find()) {
            return matcher.group(1);
        }
        return "click"; // Default action
    }

    /**
     * Extract locators from old format line.
     */
    private static Map<String, String> extractLocators(String line) {
        Map<String, String> locators = new LinkedHashMap<>();
        Matcher matcher = OLD_LOCATOR_PATTERN.matcher(line);
        
        while (matcher.find()) {
            String locator = matcher.group(1);
            String[] parts = locator.split(":", 2);
            if (parts.length == 2) {
                locators.put(parts[0].toLowerCase(), parts[1]);
            }
        }
        
        return locators;
    }

    /**
     * Extract data from old format line.
     */
    private static List<String> extractData(String line) {
        List<String> data = new ArrayList<>();
        
        // Extract starred data [*data*]
        Pattern starPattern = Pattern.compile("\\*([^*]+)\\*");
        Matcher starMatcher = starPattern.matcher(line);
        while (starMatcher.find()) {
            data.add(starMatcher.group(1));
        }
        
        // Extract caret data [^data^]
        Pattern caretPattern = Pattern.compile("\\^([^^]+)\\^");
        Matcher caretMatcher = caretPattern.matcher(line);
        while (caretMatcher.find()) {
            data.add(caretMatcher.group(1));
        }
        
        return data;
    }

    /**
     * Build natural language sentence from components.
     */
    private static String buildNaturalLanguageSentence(String action, Map<String, String> locators, List<String> data) {
        StringBuilder sentence = new StringBuilder();
        
        // Get action phrase
        String actionPhrase = ACTION_MAPPINGS.getOrDefault(action, action);
        sentence.append(actionPhrase);
        
        // Add data if present
        if (!data.isEmpty()) {
            sentence.append(" ").append(String.join(" ", data));
        }
        
        // Add locator context
        if (!locators.isEmpty()) {
            String locatorContext = buildLocatorContext(locators);
            sentence.append(" ").append(locatorContext);
        }
        
        // Add "that appears" for verify actions
        if (action.startsWith("verify") || action.startsWith("assert") || 
            action.startsWith("check") || action.startsWith("confirm")) {
            sentence.append(" appears");
        }
        
        return sentence.toString().trim();
    }

    /**
     * Build locator context string.
     */
    private static String buildLocatorContext(Map<String, String> locators) {
        StringBuilder context = new StringBuilder();
        
        for (Map.Entry<String, String> entry : locators.entrySet()) {
            String locatorType = entry.getKey();
            String locatorValue = entry.getValue();
            
            String fieldName = LOCATOR_FIELD_MAPPINGS.getOrDefault(locatorType, locatorType);
            
            if (context.length() > 0) {
                context.append(" with ");
            }
            context.append(fieldName).append(" '").append(locatorValue).append("'");
        }
        
        return context.toString();
    }

    /**
     * Migrate all flow files in a directory.
     */
    public static void migrateDirectory(String inputDir, String outputDir) throws IOException {
        Path inputPath = Paths.get(inputDir);
        Path outputPath = Paths.get(outputDir);
        
        // Create output directory if it doesn't exist
        Files.createDirectories(outputPath);
        
        // Find all .flow files
        FileFinder.Finder finder = new FileFinder.Finder("*.flow");
        Files.walkFileTree(inputPath, finder);
        
        int migratedCount = 0;
        int errorCount = 0;
        
        for (Path path : finder.getPathList()) {
            File inputFile = path.toFile();
            File outputFile = new File(outputPath.toFile(), inputFile.getName());
            
            try {
                migrateFile(inputFile, outputFile);
                migratedCount++;
            } catch (Exception e) {
                logger.error("Error migrating file " + inputFile.getAbsolutePath() + ": " + e.getMessage());
                errorCount++;
            }
        }
        
        logger.info("Migration complete: " + migratedCount + " files migrated, " + errorCount + " errors");
    }

    /**
     * Migrate all flow files in place (backup original files).
     */
    public static void migrateInPlace(String dirPath) throws IOException {
        Path path = Paths.get(dirPath);
        
        // Find all .flow files
        FileFinder.Finder finder = new FileFinder.Finder("*.flow");
        Files.walkFileTree(path, finder);
        
        int migratedCount = 0;
        int errorCount = 0;
        
        for (Path filePath : finder.getPathList()) {
            File inputFile = filePath.toFile();
            File backupFile = new File(inputFile.getAbsolutePath() + ".backup");
            
            try {
                // Create backup
                Files.copy(inputFile.toPath(), backupFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
                
                // Migrate in place
                String content = new String(Files.readAllBytes(inputFile.toPath()));
                String migratedContent = migrateContent(content);
                Files.write(inputFile.toPath(), migratedContent.getBytes());
                
                logger.info("Migrated: " + inputFile.getAbsolutePath() + " (backup: " + backupFile.getAbsolutePath() + ")");
                migratedCount++;
            } catch (Exception e) {
                logger.error("Error migrating file " + inputFile.getAbsolutePath() + ": " + e.getMessage());
                errorCount++;
            }
        }
        
        logger.info("In-place migration complete: " + migratedCount + " files migrated, " + errorCount + " errors");
        logger.info("Original files backed up with .backup extension");
    }

    /**
     * Main method for command-line usage.
     */
    public static void main(String[] args) {
        if (args.length < 1) {
            System.out.println("Usage: java SyntaxMigrationTool <command> [options]");
            System.out.println();
            System.out.println("Commands:");
            System.out.println("  migrate <inputDir> <outputDir>  - Migrate files from input to output directory");
            System.out.println("  in-place <dir>                  - Migrate files in place (with backup)");
            System.out.println("  convert <file>                  - Convert a single file (prints to stdout)");
            System.out.println();
            System.out.println("Examples:");
            System.out.println("  java SyntaxMigrationTool migrate ./flows ./migrated-flows");
            System.out.println("  java SyntaxMigrationTool in-place ./flows");
            System.out.println("  java SyntaxMigrationTool convert ./flows/example.flow");
            return;
        }
        
        String command = args[0];
        
        try {
            switch (command) {
                case "migrate":
                    if (args.length < 3) {
                        System.out.println("Usage: java SyntaxMigrationTool migrate <inputDir> <outputDir>");
                        return;
                    }
                    migrateDirectory(args[1], args[2]);
                    break;
                    
                case "in-place":
                    if (args.length < 2) {
                        System.out.println("Usage: java SyntaxMigrationTool in-place <dir>");
                        return;
                    }
                    migrateInPlace(args[1]);
                    break;
                    
                case "convert":
                    if (args.length < 2) {
                        System.out.println("Usage: java SyntaxMigrationTool convert <file>");
                        return;
                    }
                    String content = new String(Files.readAllBytes(Paths.get(args[1])));
                    System.out.println(migrateContent(content));
                    break;
                    
                default:
                    System.out.println("Unknown command: " + command);
            }
        } catch (Exception e) {
            logger.error("Error: " + e.getMessage(), e);
            System.exit(1);
        }
    }
}