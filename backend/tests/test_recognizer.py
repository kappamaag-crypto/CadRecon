import unittest
import numpy as np
import cv2
from backend.recognizer import detect_geometry, parse_paddle_result
class TestLocalRecognizer(unittest.TestCase):
    def test_ocr_parser(self):
        data={"res":{"rec_texts":["Болт М24х90","6000"],"rec_boxes":[[1,2,130,16],[40,22,90,35]],"rec_scores":[.99,.85]}}
        self.assertEqual(parse_paddle_result(data)[0]["text"],"Болт М24х90")
        self.assertAlmostEqual(parse_paddle_result(data)[1]["confidence"],.85)
    def test_lines_different_angles(self):
        image=np.full((400,600,3),255,np.uint8)
        cv2.line(image,(20,25),(560,25),(0,0,0),2)
        cv2.line(image,(30,110),(550,340),(0,0,0),2)
        cv2.line(image,(100,30),(100,350),(0,0,0),2)
        shapes=detect_geometry(image,[])
        self.assertGreaterEqual(len(shapes["lines"]),3)
        lengths=[np.hypot(v["a"][0]-v["b"][0],v["a"][1]-v["b"][1]) for v in shapes["lines"]]
        self.assertTrue(max(lengths)>400)
if __name__=="__main__":
    unittest.main()
