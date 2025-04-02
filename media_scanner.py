#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
from datetime import datetime
from PIL import Image
from PIL.ExifTags import TAGS
from pymediainfo import MediaInfo
from PyQt6.QtCore import QThread, pyqtSignal

class MediaFile:
    """媒体文件类，表示单个照片或视频文件"""
    def __init__(self, file_path, date=None, file_type="未知"):
        self.file_path = file_path
        self.filename = os.path.basename(file_path)
        self.file_size = os.path.getsize(file_path)
        self.date = date
        self.file_type = file_type
        self.status = "未处理"  # 状态：未处理、将上传、将覆盖、将跳过
        self.target_path = ""
    
    def __str__(self):
        return f"{self.filename} ({self.file_type}) - {self.status}"


class MediaScanner:
    """媒体扫描器，负责扫描和分析媒体文件"""
    def __init__(self):
        self.photo_extensions = ['.jpg', '.jpeg', '.png', '.heic', '.nef', '.cr2', '.arw']
        self.video_extensions = ['.mp4', '.mov', '.avi', '.m4v', '.3gp', '.mkv']
        self.supported_extensions = self.photo_extensions + self.video_extensions
        
    def get_photo_date(self, file_path):
        """获取照片的拍摄日期"""
        try:
            with Image.open(file_path) as img:
                exif_data = img._getexif()
                if exif_data:
                    for tag_id, value in exif_data.items():
                        tag = TAGS.get(tag_id, tag_id)
                        if tag == 'DateTimeOriginal':
                            return datetime.strptime(value, '%Y:%m:%d %H:%M:%S')
        except Exception:
            pass  # 忽略无法读取EXIF的文件
            
        # 如果无法从EXIF获取日期，使用文件修改时间
        mod_time = os.path.getmtime(file_path)
        return datetime.fromtimestamp(mod_time)
    
    def get_video_date(self, file_path):
        """获取视频的拍摄日期"""
        try:
            media_info = MediaInfo.parse(file_path)
            for track in media_info.tracks:
                if track.track_type == 'General':
                    # 尝试不同的元数据字段
                    date_fields = [
                        track.encoded_date,
                        track.tagged_date,
                        track.recorded_date
                    ]
                    
                    for date_field in date_fields:
                        if date_field:
                            # 处理不同格式的日期字符串
                            try:
                                # 格式如: UTC 2020-01-01 12:00:00
                                if date_field.startswith('UTC '):
                                    date_str = date_field[4:]
                                    return datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S')
                                # 其他可能的格式
                                else:
                                    for fmt in ['%Y-%m-%d %H:%M:%S', '%Y:%m:%d %H:%M:%S']:
                                        try:
                                            return datetime.strptime(date_field, fmt)
                                        except ValueError:
                                            continue
                            except Exception:
                                continue
        except Exception:
            pass
        
        # 如果无法从元数据获取日期，使用文件修改时间
        mod_time = os.path.getmtime(file_path)
        return datetime.fromtimestamp(mod_time)
    
    def get_media_date(self, file_path):
        """获取媒体文件的拍摄日期"""
        ext = os.path.splitext(file_path)[1].lower()
        if ext in self.photo_extensions:
            return self.get_photo_date(file_path)
        elif ext in self.video_extensions:
            return self.get_video_date(file_path)
        else:
            # 默认使用文件修改时间
            mod_time = os.path.getmtime(file_path)
            return datetime.fromtimestamp(mod_time)
    
    def scan_directory(self, source_dir):
        """扫描目录中的所有媒体文件"""
        media_files = []
        
        for root, _, files in os.walk(source_dir):
            for file in files:
                if any(file.lower().endswith(ext) for ext in self.supported_extensions):
                    file_path = os.path.join(root, file)
                    file_ext = os.path.splitext(file_path)[1].lower()
                    file_type = "照片" if file_ext in self.photo_extensions else "视频"
                    
                    try:
                        media_date = self.get_media_date(file_path)
                        media_file = MediaFile(file_path, media_date, file_type)
                        media_files.append(media_file)
                    except Exception as e:
                        print(f"处理文件失败: {file_path}, 错误: {e}")
        
        return media_files
    
    def analyze_files(self, media_files, target_dir, overwrite_duplicates):
        """分析文件将会如何被处理"""
        upload_count = 0
        overwrite_count = 0
        skip_count = 0
        
        for media_file in media_files:
            # 确定目标路径
            date_folder = media_file.date.strftime('%Y-%m-%d')
            target_date_dir = os.path.join(target_dir, date_folder)
            target_file_path = os.path.join(target_date_dir, media_file.filename)
            media_file.target_path = target_file_path
            
            # 检查是否存在相同大小的文件
            if os.path.exists(target_file_path):
                target_size = os.path.getsize(target_file_path)
                
                if media_file.file_size == target_size:
                    # 文件大小相同，跳过
                    media_file.status = "将跳过"
                    skip_count += 1
                elif overwrite_duplicates:
                    # 设置为覆盖
                    media_file.status = "将覆盖"
                    overwrite_count += 1
                else:
                    # 不覆盖，跳过
                    media_file.status = "将跳过"
                    skip_count += 1
            else:
                # 目标文件不存在，将上传
                media_file.status = "将上传"
                upload_count += 1
        
        return {
            "files": media_files,
            "stats": {
                "total": len(media_files),
                "upload": upload_count,
                "overwrite": overwrite_count,
                "skip": skip_count
            }
        }


class ScannerThread(QThread):
    """扫描线程，用于在后台执行扫描和分析"""
    progress_signal = pyqtSignal(int, int, str)  # 当前进度, 总文件数, 当前处理的文件
    finished_signal = pyqtSignal(dict)  # 扫描结果
    
    def __init__(self, source_dir, target_dir, overwrite_duplicates):
        super().__init__()
        self.source_dir = source_dir
        self.target_dir = target_dir
        self.overwrite_duplicates = overwrite_duplicates
        self.scanner = MediaScanner()
        
    def run(self):
        # 第一阶段：遍历并收集媒体文件路径
        self.progress_signal.emit(0, 100, "正在扫描文件...")
        
        try:
            # 检查源目录是否存在
            if not os.path.exists(self.source_dir):
                raise FileNotFoundError(f"源目录不存在: {self.source_dir}")
            
            # 检查目标目录是否存在
            if not os.path.exists(self.target_dir):
                raise FileNotFoundError(f"目标目录不存在: {self.target_dir}")
            
            all_files = []
            for root, _, files in os.walk(self.source_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    # 检查文件是否可访问
                    if os.path.exists(file_path):
                        all_files.append(file_path)
                    else:
                        print(f"警告: 文件不可访问: {file_path}")
                
            # 过滤出媒体文件
            media_paths = []
            for i, file_path in enumerate(all_files):
                # 每处理10个文件更新一次进度，避免过多信号
                if i % 10 == 0:
                    self.progress_signal.emit(i, len(all_files), f"正在检查文件类型: {os.path.basename(file_path)}")
                
                # 再次检查文件是否可访问
                if os.path.exists(file_path) and any(file_path.lower().endswith(ext) for ext in self.scanner.supported_extensions):
                    media_paths.append(file_path)
            
            if not media_paths:
                self.finished_signal.emit({"files": [], "stats": {"total": 0, "upload": 0, "overwrite": 0, "skip": 0}})
                return
            
            # 第二阶段：处理媒体文件
            media_files = []
            for i, file_path in enumerate(media_paths):
                self.progress_signal.emit(
                    i, 
                    len(media_paths), 
                    f"正在读取媒体信息: {os.path.basename(file_path)}"
                )
                
                try:
                    # 再次检查文件是否可访问
                    if not os.path.exists(file_path):
                        print(f"警告: 文件已不可访问: {file_path}")
                        continue
                        
                    file_ext = os.path.splitext(file_path)[1].lower()
                    file_type = "照片" if file_ext in self.scanner.photo_extensions else "视频"
                    
                    media_date = self.scanner.get_media_date(file_path)
                    media_file = MediaFile(file_path, media_date, file_type)
                    media_files.append(media_file)
                except Exception as e:
                    print(f"处理文件失败: {file_path}, 错误: {e}")
                    continue
            
            # 第三阶段：分析文件状态
            self.progress_signal.emit(0, len(media_files), "正在分析文件状态...")
            
            upload_count = 0
            overwrite_count = 0
            skip_count = 0
            
            for i, media_file in enumerate(media_files):
                # 每处理10个文件更新一次进度
                if i % 10 == 0:
                    self.progress_signal.emit(
                        i, 
                        len(media_files), 
                        f"正在分析文件: {media_file.filename}"
                    )
                
                # 再次检查源文件是否可访问
                if not os.path.exists(media_file.file_path):
                    print(f"警告: 源文件已不可访问: {media_file.file_path}")
                    continue
                
                # 确定目标路径
                date_folder = media_file.date.strftime('%Y-%m-%d')
                target_date_dir = os.path.join(self.target_dir, date_folder)
                target_file_path = os.path.join(target_date_dir, media_file.filename)
                media_file.target_path = target_file_path
                
                # 检查目标文件
                if os.path.exists(target_file_path):
                    target_size = os.path.getsize(target_file_path)
                    
                    if media_file.file_size == target_size:
                        # 文件大小相同，跳过
                        media_file.status = "将跳过"
                        skip_count += 1
                    elif self.overwrite_duplicates:
                        # 设置为覆盖
                        media_file.status = "将覆盖"
                        overwrite_count += 1
                    else:
                        # 不覆盖，跳过
                        media_file.status = "将跳过"
                        skip_count += 1
                else:
                    # 目标文件不存在，将上传
                    media_file.status = "将上传"
                    upload_count += 1
            
            # 发送完成信号和结果
            scan_results = {
                "files": media_files,
                "stats": {
                    "total": len(media_files),
                    "upload": upload_count,
                    "overwrite": overwrite_count,
                    "skip": skip_count
                }
            }
            
            self.finished_signal.emit(scan_results)
            
        except Exception as e:
            print(f"扫描过程发生错误: {e}")
            self.finished_signal.emit({"files": [], "stats": {"total": 0, "upload": 0, "overwrite": 0, "skip": 0}}) 