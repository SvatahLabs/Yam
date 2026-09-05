package com.svatah.automator.core;

import com.svatah.automator.utils.FileFinder;
import com.svatah.automator.utils.Logging;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;

/**
 * Created by atul on 22/09/17.
 */
public class PropertyMap {

    private static PropertyMap instance;

    private Properties properties;

    private PropertyMap() {
    }

    public static PropertyMap getInstance() throws InstantiationException {
        if (instance == null)
            throw new InstantiationException("Please call 'load' method  first to load properties.");
        return instance;
    }

    /*************************************************************************
     * Searches and Loads property files as a central resource.
     * Please note: Instantiate this class before loading Scenarios.
     *
     *@param rootPath starting path to search for files.
     * **********************************************************************/
    public static void load(String rootPath) throws IOException {
        if (instance == null) {
            instance = new PropertyMap();
            instance.properties = new java.util.Properties();
            for (File file : findPropertyFiles(rootPath)) {
                java.util.Properties properties = new java.util.Properties();
                properties.load(new FileInputStream(file));
                instance.properties.putAll(properties);
            }
        } else
            Logging.console("Property instance has already been loaded.");
    }

    public String getProperty(String key) {
        return properties.getProperty(key);
    }

    @SuppressWarnings(value = "unchecked assignment")
    public Map<String, String> asMap(){
        return new HashMap(properties);
    }

    private static List<File> findPropertyFiles(String rootPath) throws IOException {
        List<File> fileList = new ArrayList<>();
        Path startingDir = Paths.get(rootPath);
        String pattern = "*.properties";
        FileFinder.Finder finder = new FileFinder.Finder(pattern);
        Files.walkFileTree(startingDir, finder);
        for (Path path : finder.getPathList())
            fileList.add(path.toFile());
        return fileList;
    }
}
