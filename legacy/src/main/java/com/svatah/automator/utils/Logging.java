package com.svatah.automator.utils;

import com.svatah.automator.mappers.InfoLevel;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

/**
 * Created by atul on 12/09/17.
 */
public class Logging {

    private static final Logger log = LogManager.getLogger(Logging.class);
    private final InfoLevel infoLevel;

    public Logging(InfoLevel infoLevel) {
        this.infoLevel = infoLevel;
    }

    public InfoLevel getInfoLevel() {
        return infoLevel;
    }

    public void log(String message) {
        if (infoLevel.equals(InfoLevel.ERROR))
            log.error(message);
        else if (infoLevel.equals(InfoLevel.DEBUG))
            log.debug(message);
        else
            System.out.println(message);
    }

    public void log(String message, Object... args) {
        if (infoLevel.equals(InfoLevel.ERROR))
            log.error(message, args);
        else if (infoLevel.equals(InfoLevel.DEBUG))
            log.debug(message, args);
        else
            log.info(message, args);
    }

    public static void console(String message) {
        System.out.println(message);
    }

    public static void console(String message, Object... args) {
        System.out.println("------------------------------- "+message+" --------------------------------------");
        for(Object arg : args){
            System.out.println(arg);
        }
        System.out.println("----------------------------------------------------------------------------------");

    }
}

