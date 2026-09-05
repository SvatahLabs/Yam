package com.svatah.automator.utils;

import com.svatah.automator.exceptions.InvalidFormatException;
import com.svatah.automator.mappers.ProjectKeywords;

import java.io.*;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.channels.Channels;
import java.nio.channels.ReadableByteChannel;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;


/**
 * Created by atul on 12/09/17.
 */
public final class FileUtil {

    public static Map<String, String> getKeyValueMap(String filePath) throws IOException{
        return convertFileToMap(filePath, "=");
    }

    private static Map<String, String> convertFileToMap(String filename, String kvSeparator) throws IOException{
        String data = new String(Files.readAllBytes(FileSystems.getDefault().getPath( filename)));
        String[] lines = data.split("\\r?\\n");
        Map<String, String> map = new LinkedHashMap<>();
        for (String line : lines) {
            if (line != null) {
                //if line starts with "//", then it is treated as a comment line and ignored.
                if (!line.startsWith(ProjectKeywords.COMMENT_LINE.getKeyword()) && !line.isEmpty()) {
                    String[] kvPair = new String[2];
                    kvPair[0] = line.substring(0, line.indexOf(kvSeparator));
                    kvPair[1] = line.substring(line.indexOf(kvSeparator) + 1, line.length());
                    //if(kvPair.length!=2)
                    //    throw new InvalidPropertiesFormatException("Each line must contain one key and one value separated by "+kvSeparator+". We got : "+line);
                    map.put(kvPair[0].trim(), kvPair[1].trim());
                }
            }
        }
        return map;
    }

    public static final int BUFFER_SIZE = 4096;

    public static void deleteFile(String fileNameWithPath) {
        File file = new File(fileNameWithPath);
        if (file.exists()) {
            if (file.isDirectory()) {
                String[] fileEntries = file.list();
                for (String s : fileEntries) {
                    File currentFile = new File(file.getPath(), s);
                    currentFile.delete();
                }
            } else {
                file.delete();
            }
        } else {
            throw new RuntimeException("There is no file with name " + fileNameWithPath);
        }
    }

    public static void zipFiles(List<File> files, String zipFileName) throws Exception {
        FileOutputStream fileOutputStream = new FileOutputStream(zipFileName);
        ZipOutputStream zipOutputStream = null;
        for (File file : files) {
            zipOutputStream = new ZipOutputStream(fileOutputStream);
            ZipEntry zipEntry = new ZipEntry(file.getName());
            zipOutputStream.putNextEntry(zipEntry);

            FileInputStream fileInputStream = new FileInputStream(file.getCanonicalPath());
            byte[] buffer = new byte[1024];
            int len;
            while ((len = fileInputStream.read(buffer)) > 0) {
                zipOutputStream.write(buffer, 0, len);
            }

            fileInputStream.close();
            zipOutputStream.closeEntry();
        }
        fileOutputStream.close();
    }

    public static String unZip(String zipFile, String outputFolder) {

        byte[] buffer = new byte[1024];
        String fileName = "";
        try {

            //create output directory is not exists
            File folder = new File(outputFolder);
            if (!folder.exists()) {
                folder.mkdir();
            }

            //get the zip file content
            ZipInputStream zis =
                    new ZipInputStream(new FileInputStream(zipFile));
            //get the zipped file list entry
            ZipEntry ze = zis.getNextEntry();

            while (ze != null) {

                fileName = ze.getName();
                File newFile = new File(outputFolder + File.separator + fileName);

                System.out.println("file unzip : " + newFile.getAbsoluteFile());

                //create all non exists folders
                //else you will hit FileNotFoundException for compressed folder
                new File(newFile.getParent()).mkdirs();

                FileOutputStream fos = new FileOutputStream(newFile);

                int len;
                while ((len = zis.read(buffer)) > 0) {
                    fos.write(buffer, 0, len);
                }

                fos.close();
                ze = zis.getNextEntry();
            }

            zis.closeEntry();
            zis.close();

            System.out.println("Done");

        } catch (IOException ex) {
            ex.printStackTrace();
        }
        return fileName;
    }

    public static void sortFilesOnLastModifiedDate(File[] fileList) {
        Arrays.sort(fileList, new Comparator() {
            public int compare(Object o1, Object o2) {
                if (((File) o1).lastModified() > ((File) o2).lastModified()) {
                    return -1;
                } else if (((File) o1).lastModified() < ((File) o2).lastModified()) {
                    return +1;
                } else {
                    return 0;
                }
            }

        });
    }

    public static Iterator<Object[]> dataProviderParamsFromCsv(String fileName, boolean headers, String delimiter) {
        BufferedReader br = null;
        List<Object[]> params = new ArrayList<>();
        try {
            br = new BufferedReader(new FileReader(fileName));
            if (headers) {
                br.readLine();  // Ignore headers
            }
            String line;
            while ((line = br.readLine()) != null) {
                params.add(line.split(delimiter));
            }
        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            try {
                if (br != null) {
                    br.close();
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
        return params.iterator();
    }

    /**
     * This function takes a string input and returns list of objects
     *
     * @param entry    string which will be manipulated.
     * @param splitKey key at whose occurrence entry will be split and added to list
     * @return List<?> of keys obtained after operation.
     */
    public static List<?> dataSplitter(String entry, String splitKey) {
        List<String> str = Collections.emptyList();
        try {
            str = (Arrays.asList(entry.split(splitKey)));
        } catch (Exception e) {
            e.printStackTrace();
        }
        return str;
    }

    /**
     * This function takes a string input with comma as separators and returns list of objects
     * This method also supports escaping comma for the return list values which need comma
     * @param entry    string which will be manipulated.
     * @return List<String> of keys obtained after operation.
     * @throws InvalidFormatException if backslash character is unescaped e.g. "A\\B" is not valid, backslash should be escaped
     */
    public static List<String> commaSplitter(String entry) throws InvalidFormatException {
        if (!entry.matches("^(([^\\\\,]|\\\\,|\\\\\\\\)*(,|$))+")) {
            throw new InvalidFormatException("Invalid character found : A\\B is not valid, backslash should be escaped. e.g. A\\\\B ");
        }
        Matcher matcher = Pattern
                .compile("(?<=(^|,))([^\\\\,]|\\\\,|\\\\\\\\)*(?=(,|$))")
                .matcher(entry);
        ArrayList<String> result = new ArrayList<>();
        while (matcher.find()) {
            result.add((matcher.group().replaceAll("\\\\([\\\\,])", "$1").trim()));
        }
        return result;
    }

    public static void writeIntoFile(String data, String filePath) {
        BufferedWriter out = null;
        try {
            File file = new File(filePath);
            if (file.exists()) {
                out = new BufferedWriter(new FileWriter(filePath, false));
                out.write(data);
            } else {
                new File(filePath).createNewFile();
                out = new BufferedWriter(new FileWriter(filePath, false));
                out.write(data);

            }
        } catch (IOException e) {
            e.printStackTrace();
        } finally {
            if (out != null) {
                try {
                    out.close();
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
        }
    }

    public static void overWriteIntoFile(String data, String filePath) {
        BufferedWriter out = null;
        try {
            File file = new File(filePath);
            if (file.exists()) {
                file.delete();
                new File(filePath).createNewFile();
                out = new BufferedWriter(new FileWriter(filePath, false));
                out.write(data);
            } else {
                new File(filePath).createNewFile();
                out = new BufferedWriter(new FileWriter(filePath, false));
                out.write(data);
            }
        } catch (IOException e) {
            e.printStackTrace();
        } finally {
            if (out != null) {
                try {
                    out.close();
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
        }
    }

    /**
     * This function replaces the last occurrence of the given substring in the string with the replacement.
     *
     * @param string      which will be manipulated.
     * @param substring   whose last occurrence needs to be replaced.
     * @param replacement string which will replace substring.
     */
    public static String replaceLast(String string, String substring, String replacement) {
        int index = string.lastIndexOf(substring);
        if (index == -1)
            return string;
        return string.substring(0, index) + replacement
                + string.substring(index + substring.length());
    }

    /**
     * Copies any file to another location. Handled IOException
     * so refer stacktrace if operation is unsuccessful.
     *
     * @param originalLoc path of original file
     * @param newLoc      path where the original file needs to be copied
     */
    public static void copyFileToAnotherLocation(String originalLoc, String newLoc) {
        File originalFile = new File(originalLoc);
        File newFile = new File(newLoc);
        try {
            org.apache.commons.io.FileUtils.copyFile(originalFile, newFile);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    /**
     * Constructs a file at path for the given stream.Utilises java
     * nio library for the conversion of input stream to a file. Useful for transfer-encoded streams.
     *
     * @param inputStream The stream from which bytes are to be read
     * @param file        The full path of the file with extension(e.g. result.xlsx). Will result in corrupt file if their
     *                    mismatch in stream data and extension.
     * @throws IOException if an I/O error occurs
     */
    public static String convertStreamToFile(InputStream inputStream, String file) throws IOException {
        String reportPath = new File("").getAbsolutePath() + File.separator + file;
        ReadableByteChannel rbc = Channels.newChannel(inputStream);
        FileOutputStream fos = new FileOutputStream(reportPath);
        fos.getChannel().transferFrom(rbc, 0, Long.MAX_VALUE);
        return reportPath;
    }

    /**
     * Constructs a file at path (src/test/resources/output) for the given stream. Utilises apache
     * commons library for the conversion of input stream to a file. Useful for content-encoded streams.
     * Default byte size is 4096
     *
     * @param inputStream The stream from which bytes are to be read
     * @param fileName    The file name with extension(e.g. result.xlsx). Will result in corrupt file if their
     *                    mismatch in stream data and extension.
     * @param bufferSize  Content length of chunks (Usually it comes under the headers of response)
     * @throws IOException if an I/O error occurs
     */
    public static String convertStreamToRegularFile(InputStream inputStream, String fileName, int bufferSize) throws IOException {
        String filepath = "src" + File.separator + "test" + File.separator + "resources" + File.separator + "output";
        Files.createDirectories(Paths.get(filepath));
        String reportPath = new File("").getAbsolutePath() + File.separator + filepath + File.separator + fileName;
        OutputStream outputStream = new FileOutputStream(new File(reportPath));
        org.apache.commons.io.IOUtils.copyLarge(inputStream, outputStream);
        return reportPath;
    }

    public static String readFile(String fileName) throws IOException {
        byte[] expectedDataToString = FileUtil.convertFileToStringBuilder(fileName).toString().getBytes("UTF-8");
        return new String(expectedDataToString, "UTF-8");
    }

    public static StringBuilder convertFileToStringBuilder(String fileName) throws IOException {
        StringBuilder stringBuilder = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new FileReader(fileName))) {
            String line;
            while ((line = br.readLine()) != null) {
                stringBuilder.append(line);
                stringBuilder.append(System.lineSeparator());
            }
        }
        return stringBuilder;
    }

    public static String readRemoteFile(String fileURL) throws Exception {
        URL url = new URL(fileURL.trim());
        StringBuilder stringBuilder = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(url.openStream()))) {
            String line;
            while ((line = br.readLine()) != null) {
                stringBuilder.append(line);
                stringBuilder.append(System.lineSeparator());
            }
        }
        return stringBuilder.toString().trim();
    }

    public static String encodeURL(String url) throws UnsupportedEncodingException {
        String path = url.substring(0, url.lastIndexOf("/") + 1);
        String filename = url.substring(url.lastIndexOf("/") + 1, url.length());
        filename = URLEncoder.encode(filename, "UTF-8");
        return path + filename;
    }

    public static String downloadFileFromUrl(String url, String fileName, String destinationDir) {
        File destDir = new File(destinationDir);

        if (!destDir.exists()) {
            destDir.mkdirs();
        }
        String destinationFile = destinationDir + File.separator + fileName;

        try {
            org.apache.commons.io.FileUtils.copyURLToFile(new URL(encodeURL(url)), new File(destinationFile));
        } catch (IOException e) {
            e.printStackTrace();
        }
        return destinationFile;
    }

    public static List<String> extractFilesFromZip(String zipFilePath, String destinationDir) {
        ZipInputStream zipIn = null;
        try {
            zipIn = new ZipInputStream(new FileInputStream(new File(zipFilePath)));
        } catch (FileNotFoundException e) {
            e.printStackTrace();
        }
        ZipEntry entry = null;
        try {
            entry = zipIn.getNextEntry();
        } catch (IOException e) {
            e.printStackTrace();
        }
        List<String> filePaths = new ArrayList<>();
        try {
            while (entry != null) {
                String filePath = destinationDir + File.separator + System.currentTimeMillis() + entry.getName();
                if (!entry.isDirectory()) {
                    BufferedOutputStream bos = new BufferedOutputStream(new FileOutputStream(filePath));
                    byte[] bytesIn = new byte[BUFFER_SIZE];
                    int read;
                    while ((read = zipIn.read(bytesIn)) != -1) {
                        bos.write(bytesIn, 0, read);
                    }
                    bos.close();
                } else {
                    File dir = new File(filePath);
                    dir.mkdir();
                }
                filePaths.add(filePath);
                zipIn.closeEntry();
                entry = zipIn.getNextEntry();
            }

            zipIn.close();
        } catch (Exception e) {
            e.printStackTrace();
        }
        return filePaths;
    }
}
